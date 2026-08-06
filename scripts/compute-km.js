#!/usr/bin/env node
// Computes kmTotal for every trip from its GeoJSON track (haversine sum over
// all LineString / MultiLineString segments, plus the gaps between them —
// flights and ferries between tracks count as travelled distance) and rewrites
// the kmTotal values in data/trips.js in place.
//
// Usage:
//   node scripts/compute-km.js          # show computed vs current, update file
//   node scripts/compute-km.js --check  # show only, don't write
//
// --trips <file> / --routes <dir> point it at another dataset (the demo one).

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

const flag = name => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? null : process.argv[i + 1]
}
const tripsPath = join(root, flag('trips') ?? 'data/trips.js')
const routesDir = join(root, flag('routes') ?? 'data/routes')

const EARTH_R = 6371 // km

function haversine([lng1, lat1], [lng2, lat2]) {
  const rad = d => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(a))
}

function lineKm(coords) {
  let km = 0
  for (let i = 1; i < coords.length; i++) km += haversine(coords[i - 1], coords[i])
  return km
}

// Only routes written by make-route.js / import-trip.js store their segments in
// travel order; the older files are in whatever order they were exported in. So
// bridging the gaps in *file* order invents "flights" between segments that
// actually join end to end — 1000 km of phantom distance on a single Greek
// road trip, ~29 000 km across the whole log.
//
// Instead, reconstruct a plausible travel order: greedily chain the segments
// end to end, trying every segment and both orientations as the starting
// point, and keep whichever chain needs the least connecting distance. What's
// left after the best chain is the real flight/ferry mileage.
function chainGapKm(lines) {
  if (lines.length < 2) return 0
  const ends = lines.map(c => [c[0], c.at(-1)])
  let best = Infinity

  for (let start = 0; start < lines.length; start++) {
    for (const startFlipped of [false, true]) {
      const used = new Array(lines.length).fill(false)
      used[start] = true
      let tail = startFlipped ? ends[start][0] : ends[start][1]
      let total = 0

      for (let step = 1; step < lines.length && total < best; step++) {
        let pick = -1, pickKm = Infinity, pickFlipped = false
        for (let j = 0; j < lines.length; j++) {
          if (used[j]) continue
          const toHead = haversine(tail, ends[j][0])
          if (toHead < pickKm) { pickKm = toHead; pick = j; pickFlipped = false }
          const toTail = haversine(tail, ends[j][1])
          if (toTail < pickKm) { pickKm = toTail; pick = j; pickFlipped = true }
        }
        used[pick] = true
        total += pickKm
        tail = pickFlipped ? ends[pick][0] : ends[pick][1]
      }

      if (total < best) best = total
    }
  }
  return best
}

function trackKm(geojson) {
  const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson]
  const lines = []
  for (const f of features) {
    const g = f.geometry ?? f
    if (g?.type === 'LineString') lines.push(g.coordinates)
    else if (g?.type === 'MultiLineString') lines.push(...g.coordinates)
  }
  const nonEmpty = lines.filter(c => c?.length > 1)
  const tracked = nonEmpty.reduce((sum, coords) => sum + lineKm(coords), 0)
  const gaps = chainGapKm(nonEmpty)
  return { km: Math.round(tracked + gaps), gaps: Math.round(gaps), segments: nonEmpty.length }
}

// Each trip is a flat object literal, so `{ … }` with no nested braces isolates
// one trip at a time. Matching id and geojsonPath with a single expression
// across the whole file would silently pair one trip's id with the next trip's
// path as soon as any entry omitted a field.
const source = readFileSync(tripsPath, 'utf8')
const blocks = [...source.matchAll(/\{[^{}]*\}/g)]

const out = []
let cursor = 0
let changes = 0

console.log('trip                        current  computed   of which unrouted')
console.log('─'.repeat(66))

for (const block of blocks) {
  const text = block[0]
  const id = text.match(/id:\s*'([^']+)'/)?.[1]
  const geojsonPath = text.match(/geojsonPath:\s*'([^']*)'/)?.[1]
  if (!id) continue

  out.push(source.slice(cursor, block.index))
  cursor = block.index + text.length

  const file = geojsonPath && join(routesDir, geojsonPath.replace(/^\//, ''))
  if (!file || !existsSync(file)) {
    console.log(`${id.padEnd(28)} (no geojson — skipped)`)
    out.push(text)
    continue
  }

  const { km, gaps, segments } = trackKm(JSON.parse(readFileSync(file, 'utf8')))
  const current = Number(text.match(/kmTotal:\s*(\d+)/)?.[1] ?? NaN)
  const marker = current === km ? '' : '  ← updated'
  const gapNote = segments > 1 ? `${String(gaps).padStart(9)} km in ${segments - 1} hop(s)` : ' '.repeat(9) + ' one track'
  console.log(`${id.padEnd(28)} ${String(current).padStart(7)}  ${String(km).padStart(8)}${gapNote}${marker}`)

  if (current === km) {
    out.push(text)
  } else {
    out.push(text.replace(/(kmTotal:\s*)\d+/, `$1${km}`))
    changes++
  }
}
out.push(source.slice(cursor))

if (checkOnly) {
  console.log(`\n${changes} value(s) differ (check mode — nothing written)`)
} else if (changes > 0) {
  writeFileSync(tripsPath, out.join(''))
  console.log(`\n${changes} value(s) updated in ${tripsPath.replace(root + '/', '')}`)
} else {
  console.log('\nAll values already match.')
}
