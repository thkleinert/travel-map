// Client half of edit mode. The backend is /api/edit — the Pages Function in
// functions/api/edit/ when deployed, a dev-server middleware in vite.config.js
// under `npm run dev`. Both expose the same four endpoints; see the Function
// for the contract.

// → { head } when editing is available here, null otherwise (no backend, or
// the deployed Function isn't configured — it answers 404 then)
export async function editStatus() {
  try {
    const res = await fetch('/api/edit', { cache: 'no-store' })
    if (!res.ok) return null
    const body = await res.json()
    return body.enabled ? { head: body.head } : null
  } catch {
    // SPA fallback answers unknown paths with index.html — not JSON
    return null
  }
}

async function request(path, init) {
  const res = await fetch(`/api/edit${path}`, { cache: 'no-store', ...init })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  return res
}

// Native base64 of a (possibly 12 MB) string, without a JS loop
function toBase64(text) {
  return new Promise((ok, fail) => {
    const fr = new FileReader()
    fr.onload = () => ok(fr.result.slice(fr.result.indexOf(',') + 1))
    fr.onerror = () => fail(fr.error)
    fr.readAsDataURL(new Blob([text]))
  })
}

const round6 = n => Math.round(n * 1e6) / 1e6
const samePos = (a, b) => a[0] === b[0] && a[1] === b[1]

// Rewrite a route file's Point features to match `stops`, leaving every other
// feature — the tracks — untouched. The map was drawn from the build's
// simplified copy, so its stop coordinates are rounded: a stop that wasn't
// dragged keeps its original full-precision position, and each loaded stop is
// checked against the source point it claims to be before anything is written.
//
// stops: [{ name, pos: [lat, lng], src: index among the file's Points | null
//           for a new stop, orig: pos as loaded }] in display order.
export function applyStops(text, stops, loadedCount) {
  const gj = JSON.parse(text)
  const points = gj.features.filter(f => f.geometry?.type === 'Point')
  if (points.length !== loadedCount) {
    throw new Error('the route file has changed since the page loaded — reload first')
  }

  const bySrc = new Map(stops.filter(s => s.src != null).map(s => [s.src, s]))
  let k = -1
  const features = []
  for (const f of gj.features) {
    if (f.geometry?.type !== 'Point') { features.push(f); continue }
    k++
    const stop = bySrc.get(k)
    if (!stop) continue // deleted
    const [lng, lat] = f.geometry.coordinates
    if (Math.abs(lat - stop.orig[0]) > 1e-3 || Math.abs(lng - stop.orig[1]) > 1e-3) {
      throw new Error(`stop "${stop.name}" doesn't match the route file — reload first`)
    }
    const moved = !samePos(stop.pos, stop.orig)
    features.push({
      ...f,
      properties: { ...f.properties, name: stop.name },
      geometry: moved ? { ...f.geometry, coordinates: [round6(stop.pos[1]), round6(stop.pos[0])] } : f.geometry,
    })
  }
  for (const s of stops) {
    if (s.src != null) continue
    features.push({
      type: 'Feature',
      properties: { name: s.name },
      geometry: { type: 'Point', coordinates: [round6(s.pos[1]), round6(s.pos[0])] },
    })
  }
  gj.features = features

  // Keep the file's own layout so diffs stay about the stops: make-route
  // writes compact JSON, older files are 2-space pretty-printed.
  const out = /^\{\s*\n/.test(text) ? JSON.stringify(gj, null, 2) : JSON.stringify(gj)
  return text.endsWith('\n') ? out + '\n' : out
}

// Stops in the order applyStops writes them — survivors in file order, then
// the added ones — re-indexed as the new baseline once a save has landed.
export function normalizeStops(stops) {
  const kept  = stops.filter(s => s.src != null).sort((a, b) => a.src - b.src)
  const added = stops.filter(s => s.src == null)
  return [...kept, ...added].map((s, i) => ({ ...s, src: i, orig: s.pos }))
}

// changes: [{ file: 'trip.geojson', stops, loadedCount }]
// Resolves to the new head commit sha.
export async function saveStops({ head, message, changes }) {
  const files = []
  for (const c of changes) {
    const text = await (await request(`/file/${encodeURIComponent(c.file)}?ref=${head}`)).text()
    const next = applyStops(text, c.stops, c.loadedCount)
    if (next === text) continue
    const { sha } = await (await request('/blob', { method: 'POST', body: await toBase64(next) })).json()
    files.push({ name: c.file, sha })
  }
  if (!files.length) return head
  const { commit } = await (await request('/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent: head, message, files }),
  })).json()
  return commit
}

// Name suggestion for a stop dropped on the map — the same address fields
// the bulk naming used, most specific first. Best effort: null on any failure.
export async function suggestName([lat, lng]) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 2500)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`,
      { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const { address: a = {}, name } = await res.json()
    return a.city || a.town || a.village || a.hamlet || a.municipality || a.suburb || name || null
  } catch {
    return null
  }
}
