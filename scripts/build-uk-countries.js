#!/usr/bin/env node
// One-off build step: produces src/data/ukCountries.topo.json — a single
// simplified shape each for England, Scotland, Wales, and Northern Ireland.
//
// world-atlas's admin-0 boundaries have no notion of the UK's constituent
// countries (just "United Kingdom" as a whole), so trips there can't be told
// apart on the visited-countries overlay. Natural Earth doesn't ship a
// convenient country-level UK subdivision file either — the smallest
// available public source is martinjc/UK-GeoJSON's local-authority-district
// boundaries, dissolved into one national outline per nation (topojson's
// `merge`) and then simplified (they're ~37MB combined at full council-level
// coastline detail, which is absurd for a subtle background tint).
//
// Re-run only if the upstream source updates or a different resolution is
// wanted. Requires topojson-server + topojson-simplify (dev-only, not a
// runtime dependency — install with `npm install --no-save topojson-server
// topojson-simplify` first).
//
// Usage: node scripts/build-uk-countries.js

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { merge } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify, quantile } from 'topojson-simplify'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = join(root, 'src', 'data', 'ukCountries.topo.json')

const SOURCES = [
  { path: 'json/administrative/eng/topo_lad.json', obj: 'lad', name: 'England' },
  { path: 'json/administrative/wal/topo_lad.json', obj: 'lad', name: 'Wales' },
  { path: 'json/administrative/sco/topo_lad.json', obj: 'lad', name: 'Scotland' },
  { path: 'json/administrative/ni/topo_lgd.json', obj: 'lgd', name: 'Northern Ireland' },
]
const BASE_URL = 'https://raw.githubusercontent.com/martinjc/UK-GeoJSON/master/'

// Fraction of simplification "weight" to discard — lower keeps fewer points.
// 0.012 lands around 140KB gzipped; still clearly recognizable shapes.
const SIMPLIFY_QUANTILE = 0.012

async function main() {
  console.log('Downloading district-level source files…')
  const features = []
  for (const { path, obj, name } of SOURCES) {
    const res = await fetch(BASE_URL + path)
    if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`)
    const topo = await res.json()
    const merged = merge(topo, topo.objects[obj].geometries)
    features.push({ type: 'Feature', properties: { name }, geometry: merged })
    console.log(`  ${name}: dissolved ${topo.objects[obj].geometries.length} districts`)
  }

  console.log('Building shared topology and simplifying…')
  let topo = topology({ countries: { type: 'FeatureCollection', features } })
  topo = presimplify(topo)
  const threshold = quantile(topo, SIMPLIFY_QUANTILE)
  topo = simplify(topo, threshold)

  writeFileSync(outPath, JSON.stringify(topo))
  console.log(`\nWrote ${outPath}`)
}

main().catch(err => { console.error(err); process.exit(1) })
