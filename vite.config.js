import { copyFileSync, createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { simplifyGeoJSONText } from './scripts/simplify-geojson.js'

// Route .geojson files are copied into dist/ verbatim, which means the browser
// downloads full OSRM road precision — 72 MB, ~967 000 coordinate pairs — for a
// map that starts at zoom 2. Thin the copies in dist/ and leave the sources
// alone, so `npm run km` keeps measuring the real geometry.
function simplifyRouteGeoJSON() {
  return {
    name: 'simplify-route-geojson',
    apply: 'build',
    closeBundle() {
      const dir = 'dist'
      let before = 0
      let after = 0
      let count = 0

      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.geojson')) continue
        const file = join(dir, name)
        const raw = readFileSync(file, 'utf8')
        let slim
        try {
          slim = simplifyGeoJSONText(raw)
        } catch (err) {
          this.warn(`could not simplify ${name}: ${err.message}`)
          continue
        }
        writeFileSync(file, slim)
        before += raw.length
        after += statSync(file).size
        count++
      }

      if (count) {
        const mb = n => (n / 1024 / 1024).toFixed(1)
        console.log(
          `\nsimplify-route-geojson: ${count} route files, ` +
          `${mb(before)} MB → ${mb(after)} MB ` +
          `(−${Math.round((1 - after / before) * 100)}%)`
        )
      }
    },
  }
}

// The route files live next to their dataset rather than in Vite's publicDir
// (that's `public/` — favicon, _headers): serve them at /<name>.geojson in dev
// and copy them into dist/ on build, where simplifyRouteGeoJSON() then runs.
function datasetRoutes(dir) {
  return {
    name: 'dataset-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!/^\/[^/]+\.geojson$/.test(path)) return next()
        const file = join(dir, path.slice(1))
        if (!existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/geo+json')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.geojson')) continue
        copyFileSync(join(dir, name), join('dist', name))
      }
    },
  }
}

// The app reads one of two swappable datasets, each a trips.js plus a routes/
// dir of .geojson files: data/ holds your real travel log (absent in the
// template — create it, or `npm run route` will), demo/ a synthetic one used
// for README screenshots and for trying the app out without anybody's real
// itineraries. DEMO=1 forces the demo; otherwise data/ wins when it exists, so
// a fresh clone runs on the demo out of the box.
const demo = !!process.env.DEMO || !existsSync(resolve('data/trips.js'))
const dataset = demo ? 'demo' : 'data'

export default defineConfig({
  plugins: [react(), datasetRoutes(resolve(dataset, 'routes')), simplifyRouteGeoJSON()],
  publicDir: 'public',
  resolve: {
    alias: [{ find: /^(\.\.?\/)+data\/trips$/, replacement: resolve(dataset, 'trips.js') }],
  },
  build: {
    // the visited-countries boundaries are a deliberately code-split async
    // chunk, so the default 500 kB warning is just noise here
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    strictPort: !!process.env.PORT,
  },
})
