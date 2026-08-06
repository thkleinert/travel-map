#!/usr/bin/env node
// Builds a trip GeoJSON from a list of stops: geocodes place names
// (Nominatim/OSM), routes road legs between consecutive stops (public OSRM
// server), and writes data/routes/<trip-id>.geojson in the same shape as the
// existing files — LineString per routed leg, Point per stop (with name,
// so tooltips become possible), and no line for flight legs (the gap between
// segments counts as a flight in the app and in compute-km).
//
// Usage:
//   node scripts/make-route.js <stops.json> <trip-id>
//   → writes data/routes/<trip-id>.geojson
//
// stops.json is an array; each entry is one of:
//   "Heraklion"                          place name (geocoded)
//   [35.34, 25.13]                       [lat, lng]
//   { "name": "Chania" }                 geocoded, name kept for the Point
//   { "name": "Tokyo", "fly": true }     arrive here by air — no road leg
//   { "name": "Nagoya", "via": true }    route through here, but no stop marker
//   { "coords": [35.68, 139.69], "name": "Tokyo" }
//
// After writing, run `npm run km` to fill in kmTotal.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2).filter(a => a !== '--force')
const force = process.argv.includes('--force')
const [stopsFile, tripId] = args

if (!stopsFile || !tripId) {
  console.error('Usage: node scripts/make-route.js <stops.json> <trip-id> [--force]')
  process.exit(1)
}

// The id becomes both a filename and a URL path, so keep it to a plain slug.
if (!/^[a-z0-9][a-z0-9-]*$/.test(tripId)) {
  console.error(`Invalid trip id "${tripId}" — use lowercase letters, digits and hyphens.`)
  process.exit(1)
}

// ROUTES_DIR lets the demo dataset be generated into demo/routes instead
const routesDir = join(root, process.env.ROUTES_DIR || 'data/routes')
mkdirSync(routesDir, { recursive: true })
const outPath = join(routesDir, `${tripId}.geojson`)
if (existsSync(outPath) && !force) {
  console.error(`${outPath} already exists. Re-run with --force to overwrite it.`)
  process.exit(1)
}

// Nominatim's usage policy requires an identifiable app *and* a way to reach
// its operator; a bare token is what gets rate-limited or blocked.
const USER_AGENT = process.env.CONTACT
  ? `travel-map-route-builder (${process.env.CONTACT})`
  : 'travel-map-route-builder (+https://github.com/thkleinert/travel-map)'

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function geocode(name) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`Nominatim ${res.status} for "${name}"`)
  const hits = await res.json()
  if (!hits.length) throw new Error(`No geocoding result for "${name}"`)
  await sleep(1100) // Nominatim usage policy: max 1 req/s
  return [Number(hits[0].lat), Number(hits[0].lon)]
}

// Returns a LineString, or null when OSRM says there genuinely is no drivable
// route (ocean, island hop). A rate-limit or server error is NOT that: the
// public demo server 429s and 5xx's under load, and quietly turning those into
// gaps would bill a straight line as a flight in compute-km and inflate the
// trip's distance for good. Those are retried, then fatal.
async function route(from, to) {
  // OSRM wants lng,lat
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })

    if (res.status === 429 || res.status >= 500) {
      const wait = 1000 * 2 ** (attempt - 1)
      if (attempt === 4) throw new Error(`OSRM ${res.status} after ${attempt} attempts — aborting rather than recording a phantom flight leg`)
      process.stdout.write(`OSRM ${res.status}, retrying in ${wait / 1000}s … `)
      await sleep(wait)
      continue
    }
    if (!res.ok) throw new Error(`OSRM ${res.status}`)

    const data = await res.json()
    await sleep(300)
    if (data.code === 'NoRoute' || !data.routes?.length) return null
    if (data.code !== 'Ok') throw new Error(`OSRM replied "${data.code}"`)
    return data.routes[0].geometry // GeoJSON LineString, [lng, lat] coords
  }
}

// ── Resolve stops ─────────────────────────────────────────────────────────────

const raw = JSON.parse(readFileSync(stopsFile, 'utf8'))
const stops = []

for (const entry of raw) {
  let name = null, coords = null, fly = false, via = false
  if (typeof entry === 'string') name = entry
  else if (Array.isArray(entry)) coords = entry
  else ({ name = null, coords = null, fly = false, via = false } = entry)

  if (!coords) {
    process.stdout.write(`geocoding "${name}" … `)
    coords = await geocode(name)
    console.log(`[${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}]`)
  }
  stops.push({ name, coords, fly, via })
}

// ── Route legs ────────────────────────────────────────────────────────────────

const features = []

for (let i = 1; i < stops.length; i++) {
  const from = stops[i - 1], to = stops[i]
  const legName = `${from.name ?? 'stop'} → ${to.name ?? 'stop'}`

  if (to.fly) {
    console.log(`leg ${legName}: flight — leaving gap`)
    continue
  }

  process.stdout.write(`routing ${legName} … `)
  const geometry = await route(from.coords, to.coords)
  if (geometry) {
    console.log(`${geometry.coordinates.length} points`)
    features.push({ type: 'Feature', properties: { name: legName }, geometry })
  } else {
    console.log('no road route found — leaving gap (counted as flight/ferry)')
  }
}

// Stop markers, with names for future tooltips (via waypoints get none)
for (const s of stops) {
  if (s.via) continue
  features.push({
    type: 'Feature',
    properties: s.name ? { name: s.name } : {},
    geometry: { type: 'Point', coordinates: [s.coords[1], s.coords[0]] },
  })
}

// ── Write + report ────────────────────────────────────────────────────────────

writeFileSync(outPath, JSON.stringify({ type: 'FeatureCollection', features }))

const lats = stops.map(s => s.coords[0])
const lngs = stops.map(s => s.coords[1])
const center = [
  ((Math.min(...lats) + Math.max(...lats)) / 2).toFixed(2),
  ((Math.min(...lngs) + Math.max(...lngs)) / 2).toFixed(2),
]

console.log(`\nWrote ${outPath}`)
console.log(`\nAdd to data/trips.js (then run \`npm run km\`):`)
console.log(`  {
    id:          '${tripId}',
    name:        '…',
    countries:   ['…'],
    dateStart:   '…',
    dateEnd:     '…',
    kmTotal:     0,
    photoCount:  0,
    geojsonPath: '/${tripId}.geojson',
    destCoords:  [${center[0]}, ${center[1]}],
  },`)
