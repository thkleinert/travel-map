import { feature } from 'topojson-client'
import worldTopo from 'world-atlas/countries-50m.json'
import ukTopo from './ukCountries.topo.json'

// Natural Earth's country names (via world-atlas) occasionally differ from
// the labels used in trips.js — map ours to theirs where they diverge.
const NAME_ALIASES = {
  'USA':                    'United States of America',
  'Czech Republic':         'Czechia',
  'Türkiye':                'Turkey',
  'Dominican Republic':     'Dominican Rep.',
  'Bosnia and Herzegovina': 'Bosnia and Herz.',
}

// Countries whose admin-0 polygon in this dataset bundles a distant overseas
// territory into the same shape as the mainland (e.g. France's polygon
// includes French Guiana, Martinique, Guadeloupe, Réunion, Mayotte — all
// thousands of km away). Visiting "France" shouldn't silently imply having
// been to French Guiana too. Sub-polygons farther than `maxKm` from `near`
// are dropped by default. Add an entry here if another country needs it —
// there's no per-territory opt-back-in yet (flag it if one's actually
// visited; nobody in the data has been to one of these pieces so far).
const OVERSEAS_EXCLUSIONS = {
  France: { near: [2.5, 46.5], maxKm: 1500 }, // keeps mainland + Corsica
}

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

function ringCentroid(ring) {
  let x = 0, y = 0
  for (const p of ring) { x += p[0]; y += p[1] }
  return [x / ring.length, y / ring.length]
}

function dropOverseasPieces(geometry, countryName) {
  const rule = OVERSEAS_EXCLUSIONS[countryName]
  if (!rule || geometry.type !== 'MultiPolygon') return geometry
  const kept = geometry.coordinates.filter(rings =>
    haversine(rule.near, ringCentroid(rings[0])) <= rule.maxKm
  )
  return { type: 'MultiPolygon', coordinates: kept }
}

// A few countries (Russia, Fiji, Antarctica) have a ring that crosses the
// ±180° antimeridian without being split there. Leaflet has no idea the map
// wraps, so it just draws a straight line between the two far-apart points —
// visually a spurious line stretching across the map.
//
// Rather than splitting the ring (which breaks it into open fragments that
// Leaflet then auto-closes with its OWN spurious straight line — e.g. Russia's
// ring closes near Vladivostok, right next to North Korea, so a naive split
// drew a bogus line from the Far East clear back to the Korean border),
// unwrap the longitude instead: whenever a jump bigger than 180° is seen,
// shift all subsequent points by ∓360° so the sequence stays continuous.
// The ring stays a single closed loop (points may extend slightly past
// ±180°, which Leaflet and the tile layer both render seamlessly).
function unwrapRing(ring) {
  const out = [ring[0]]
  let offset = 0
  for (let i = 1; i < ring.length; i++) {
    let lng = ring[i][0] + offset
    const prevLng = out[i - 1][0]
    while (lng - prevLng > 180) { offset -= 360; lng -= 360 }
    while (prevLng - lng > 180) { offset += 360; lng += 360 }
    out.push([lng, ring[i][1]])
  }
  return out
}

// Leaflet always closes a polygon ring by connecting its last point back to
// its first — so any ring that doesn't already end where it started draws a
// spurious straight edge across whatever lies between (the exact class of
// bug the antimeridian fix above addresses). A dissolve+simplify pipeline
// can occasionally leave one ring like that (seen once, in a simplified UK
// nation boundary — 207 points, off by ~2°, almost certainly a topojson-
// simplify artifact rather than real geography). Drop rings that don't
// close within a generous tolerance rather than render a broken shape.
const CLOSURE_TOLERANCE_DEG = 0.5

function ringCloses(ring) {
  const first = ring[0], last = ring[ring.length - 1]
  return Math.abs(first[0] - last[0]) <= CLOSURE_TOLERANCE_DEG
      && Math.abs(first[1] - last[1]) <= CLOSURE_TOLERANCE_DEG
}

function sanitizeGeometry(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  const fixed = []
  for (const rings of polygons) {
    const unwrapped = rings.map(unwrapRing)
    if (!ringCloses(unwrapped[0])) continue // broken exterior — drop the whole piece
    fixed.push([unwrapped[0], ...unwrapped.slice(1).filter(ringCloses)]) // holes may be dropped individually
  }
  return { type: 'MultiPolygon', coordinates: fixed }
}

// world-atlas has no notion of the UK's constituent countries (just "United
// Kingdom" as a whole), so a trip to Northern Ireland or a standalone visit
// to England can't be told apart there. ukCountries.topo.json (built by
// scripts/build-uk-countries.js) supplies England / Scotland / Wales /
// Northern Ireland as their own shapes instead.
const WORLD_GEOJSON = feature(worldTopo, worldTopo.objects.countries)
const UK_GEOJSON = feature(ukTopo, ukTopo.objects.countries)
const ALL_FEATURES = [...WORLD_GEOJSON.features, ...UK_GEOJSON.features]

function toAtlasName(country) {
  return NAME_ALIASES[country] ?? country
}

// FeatureCollection of just the countries in `visited` (a Set of trips.js
// country names). Countries with no matching boundary are silently skipped.
export function visitedCountriesGeoJSON(visited) {
  const atlasNames = new Set([...visited].map(toAtlasName))
  const features = ALL_FEATURES
    .filter(f => atlasNames.has(f.properties.name))
    .map(f => ({
      ...f,
      geometry: sanitizeGeometry(dropOverseasPieces(f.geometry, f.properties.name)),
    }))

  // A country whose name doesn't match Natural Earth's just fails to highlight,
  // with nothing to show for it — say so instead of silently dropping it.
  if (features.length !== atlasNames.size) {
    const matched = new Set(features.map(f => f.properties.name))
    const unmatched = [...atlasNames].filter(n => !matched.has(n))
    if (unmatched.length) {
      console.warn(
        `Visited-countries overlay: no boundary found for ${unmatched.map(n => `"${n}"`).join(', ')}. ` +
        'Add an entry to NAME_ALIASES in src/data/worldCountries.js.'
      )
    }
  }

  return { type: 'FeatureCollection', features }
}
