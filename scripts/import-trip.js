#!/usr/bin/env node
// Imports a trip from the travel-planner app into this map. The planner
// exposes a completed trip's *visited* places as travel-map-shaped GeoJSON
// (routed LineStrings + named Point stops) via a share-token endpoint — so
// unlike make-route.js this needs no OSRM/geocoding for the route itself; the
// planner already computed it. We only reverse-geocode the stops to fill in
// the `countries` list, which the planner doesn't track.
//
// Usage:
//   node scripts/import-trip.js <share-token | full-url> <trip-id>
//   → writes data/routes/<trip-id>.geojson, prints a trips.js entry
//
// Then, as with make-route.js: paste the entry into data/trips.js and run
// `npm run km` to fill in kmTotal.
//
// The planner endpoint base can be overridden with TRIP_EXPORT_URL; the
// default points at the deployed Supabase function.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2).filter(a => a !== '--force')
const force = process.argv.includes('--force')
const [tokenOrUrl, tripId] = args

if (!tokenOrUrl || !tripId) {
  console.error('Usage: node scripts/import-trip.js <share-token | full-url> <trip-id> [--force]')
  process.exit(1)
}

// The id becomes both a filename and a URL path, so keep it to a plain slug.
if (!/^[a-z0-9][a-z0-9-]*$/.test(tripId)) {
  console.error(`Invalid trip id "${tripId}" — use lowercase letters, digits and hyphens.`)
  process.exit(1)
}

const routesDir = join(root, process.env.ROUTES_DIR || 'data/routes')
mkdirSync(routesDir, { recursive: true })
const outPath = join(routesDir, `${tripId}.geojson`)
if (existsSync(outPath) && !force) {
  console.error(`${outPath} already exists. Re-run with --force to overwrite it.`)
  process.exit(1)
}

const EXPORT_BASE =
  process.env.TRIP_EXPORT_URL ||
  'https://zbztaogvmivuobibcyjn.supabase.co/functions/v1/trip-geojson'

const url = tokenOrUrl.startsWith('http')
  ? tokenOrUrl
  : `${EXPORT_BASE}?token=${encodeURIComponent(tokenOrUrl)}`

// Nominatim's usage policy requires an identifiable app *and* a way to reach
// its operator; a bare token is what gets rate-limited or blocked.
const USER_AGENT = process.env.CONTACT
  ? `travel-map-trip-importer (${process.env.CONTACT})`
  : 'travel-map-trip-importer (+https://github.com/thkleinert/travel-map)'

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Country for a stop, from its [lng, lat]. Nominatim reverse geocode at a
// coarse zoom; usage policy is max 1 req/s, hence the sleep in the caller.
async function countryOf([lng, lat]) {
  // accept-language=en so names come back as e.g. "Thailand", not "ประเทศไทย" —
  // trips.js matches countries against English Natural Earth names.
  const u = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=3&accept-language=en&lat=${lat}&lon=${lng}`
  const res = await fetch(u, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
  })
  if (!res.ok) return null
  const data = await res.json()
  return data?.address?.country ?? null
}

// ── Fetch the trip export ─────────────────────────────────────────────────────

process.stdout.write(`fetching ${url} … `)
const res = await fetch(url)
if (!res.ok) {
  console.log(`HTTP ${res.status}`)
  const body = await res.text().catch(() => '')
  console.error(body || 'request failed')
  process.exit(1)
}
const payload = await res.json()
console.log('ok')

const { metadata, ...geojson } = payload
const stops = geojson.features.filter(f => f.geometry.type === 'Point')

if (stops.length === 0) {
  console.error(
    '\nThis trip has no visited places yet — nothing to import.\n' +
      'Mark places as visited in the planner first, then re-run.',
  )
  process.exit(1)
}

// ── Write the GeoJSON (without the metadata envelope) ─────────────────────────

writeFileSync(outPath, JSON.stringify(geojson))
console.log(`\nWrote ${outPath} (${stops.length} stops, ${geojson.features.length - stops.length} legs)`)

// ── Derive the country list from the stops (in travel order, deduped) ─────────

process.stdout.write('resolving countries … ')
const countries = []
for (const s of stops) {
  const c = await countryOf(s.geometry.coordinates)
  if (c && !countries.includes(c)) countries.push(c)
  await sleep(1100) // Nominatim: max 1 req/s
}
console.log(countries.length ? countries.join(', ') : '(none resolved — fill manually)')

// Nominatim's names don't always match the Natural Earth ones the visited-
// countries overlay looks up (it answers "United States", the atlas has
// "United States of America"), and a mismatch just fails to highlight with
// nothing to show for it. Check them here, while there's someone watching.
const worldTopo = JSON.parse(
  readFileSync(new URL('../node_modules/world-atlas/countries-50m.json', import.meta.url), 'utf8')
)
const atlasNames = new Set(worldTopo.objects.countries.geometries.map(g => g.properties?.name))
const ALIASED = { 'United States of America': 'USA', Czechia: 'Czech Republic', Turkey: 'Türkiye', 'Dominican Rep.': 'Dominican Republic', 'Bosnia and Herz.': 'Bosnia and Herzegovina' }
const unknown = countries.filter(c => !atlasNames.has(c) && !Object.values(ALIASED).includes(c))
if (unknown.length) {
  console.warn(
    `\n⚠ ${unknown.map(c => `"${c}"`).join(', ')} — no matching boundary in world-atlas, so ` +
    'these will not highlight on the visited-countries overlay. Either use the atlas spelling ' +
    'or add an alias to NAME_ALIASES in src/data/worldCountries.js.'
  )
}

// The planner only records the places you stopped at, so a country the route
// merely drives through never appears here.
console.log('\nNote: countries come from the stops only — add any the route just passes through.')

// ── Print the trips.js entry ──────────────────────────────────────────────────

const dc = metadata?.destCoords
const fmtCountries = countries.length
  ? `[${countries.map(c => `'${c.replace(/'/g, "\\'")}'`).join(', ')}]`
  : `['…']`

console.log(`\nAdd to data/trips.js (then run \`npm run km\`):`)
console.log(`  {
    id:          '${tripId}',
    name:        '${(metadata?.name ?? '…').replace(/'/g, "\\'")}',
    countries:   ${fmtCountries},
    dateStart:   '${metadata?.dateStart ?? '…'}',
    dateEnd:     '${metadata?.dateEnd ?? '…'}',
    kmTotal:     0,
    photoCount:  0,
    geojsonPath: '/${tripId}.geojson',
    destCoords:  ${dc ? `[${dc[0].toFixed(2)}, ${dc[1].toFixed(2)}]` : '[…, …]'},
  },`)
