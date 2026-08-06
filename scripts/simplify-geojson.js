// Route tracks come off OSRM at full road-network precision: ~967 000 coordinate
// pairs across the log, 72 MB raw, with a third elevation element in the older
// files that nothing reads. At the zoom levels these are actually looked at,
// most of those points land inside the same pixel.
//
// This shrinks them for delivery only — routes/*.geojson keeps full precision,
// so `npm run km` still measures the real geometry. Used by the Vite plugin in
// vite.config.js, which rewrites the copies in dist/.

// ~11 m at the equator: about a third of a pixel at zoom 12, well below the
// maxZoom 9 the map fits a route to.
const TOLERANCE_DEG = 1e-4
// 5 decimals ≈ 1 m precision.
const DECIMALS = 5

function round(coord, decimals) {
  const f = 10 ** decimals
  // The elevation third element (legacy files only) is dropped — nothing reads it.
  return [Math.round(coord[0] * f) / f, Math.round(coord[1] * f) / f]
}

// Ramer–Douglas–Peucker, iterative so a pathological run of near-collinear
// points can't blow the stack. Longitude is scaled by cos(lat) so the
// tolerance means the same distance north and south.
function simplifyLine(coords, tolerance) {
  if (coords.length < 3) return coords

  const latScale = Math.cos((coords[0][1] * Math.PI) / 180) || 1
  const sqTol = tolerance * tolerance

  const keep = new Uint8Array(coords.length)
  keep[0] = 1
  keep[coords.length - 1] = 1

  const stack = [[0, coords.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    if (last - first < 2) continue

    const [ax, ay] = coords[first]
    const [bx, by] = coords[last]
    const dx = (bx - ax) * latScale
    const dy = by - ay
    const segSq = dx * dx + dy * dy

    let farthest = -1
    let farthestSq = -1
    for (let i = first + 1; i < last; i++) {
      const px = (coords[i][0] - ax) * latScale
      const py = coords[i][1] - ay
      let sq
      if (segSq === 0) {
        sq = px * px + py * py
      } else {
        // squared distance from the point to the segment
        let t = (px * dx + py * dy) / segSq
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const ox = px - t * dx
        const oy = py - t * dy
        sq = ox * ox + oy * oy
      }
      if (sq > farthestSq) { farthestSq = sq; farthest = i }
    }

    if (farthestSq > sqTol) {
      keep[farthest] = 1
      stack.push([first, farthest], [farthest, last])
    }
  }

  const out = []
  for (let i = 0; i < coords.length; i++) if (keep[i]) out.push(coords[i])
  return out
}

function simplifyGeometry(geometry, opts) {
  if (!geometry) return geometry
  const { tolerance, decimals } = opts
  const line = coords => simplifyLine(coords, tolerance).map(c => round(c, decimals))

  switch (geometry.type) {
    case 'LineString':
      return { ...geometry, coordinates: line(geometry.coordinates) }
    case 'MultiLineString':
      return { ...geometry, coordinates: geometry.coordinates.map(line) }
    case 'Point':
      return { ...geometry, coordinates: round(geometry.coordinates, decimals) }
    case 'MultiPoint':
      return { ...geometry, coordinates: geometry.coordinates.map(c => round(c, decimals)) }
    default:
      return geometry
  }
}

// Takes and returns a JSON string, so callers can report the byte saving.
export function simplifyGeoJSONText(text, { tolerance = TOLERANCE_DEG, decimals = DECIMALS } = {}) {
  const gj = JSON.parse(text)
  const opts = { tolerance, decimals }

  if (gj.type === 'FeatureCollection') {
    gj.features = gj.features.map(f => ({ ...f, geometry: simplifyGeometry(f.geometry, opts) }))
  } else if (gj.type === 'Feature') {
    gj.geometry = simplifyGeometry(gj.geometry, opts)
  } else {
    return JSON.stringify(simplifyGeometry(gj, opts))
  }
  return JSON.stringify(gj)
}
