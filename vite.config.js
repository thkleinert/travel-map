import { createHash } from 'node:crypto'
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
//
// Their URLs never change, so on build each file's content hash is exposed as
// `virtual:route-versions` ({ 'trip.geojson': 'a1b2c3d4e5' }) and the app
// fetches /trip.geojson?v=<hash> — an edited or re-imported route can't be
// served from a stale browser cache. Dev serves uncached and gets no versions.
function datasetRoutes(dir) {
  let isBuild = false
  return {
    name: 'dataset-routes',
    configResolved(config) { isBuild = config.command === 'build' },
    resolveId(id) { if (id === 'virtual:route-versions') return '\0virtual:route-versions' },
    load(id) {
      if (id !== '\0virtual:route-versions') return
      const versions = {}
      if (isBuild) {
        for (const name of readdirSync(dir)) {
          if (!name.endsWith('.geojson')) continue
          versions[name] = createHash('sha1').update(readFileSync(join(dir, name))).digest('hex').slice(0, 10)
        }
      }
      return `export default ${JSON.stringify(versions)}`
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0])
        if (!/^\/[^/]+\.geojson$/.test(path)) return next()
        const file = join(dir, path.slice(1))
        if (!existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/geo+json')
        res.setHeader('Cache-Control', 'no-store')
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

// Dev-server twin of functions/api/edit/[[path]].js — the same four endpoints,
// backed by the local routes dir instead of the GitHub API, so edit mode works
// under `npm run dev` with no setup. Changes land straight in the dataset's
// routes/*.geojson; commit them like any other data change.
function devEditApi(dir) {
  const blobs = new Map()
  const send = (res, status, body) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  const readBody = req => new Promise((ok, fail) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', fail)
  })
  return {
    name: 'dev-edit-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/edit', async (req, res) => {
        try {
          const path = (req.url ?? '').split('?')[0]
          if (req.method === 'GET' && (path === '/' || path === '')) {
            return send(res, 200, { enabled: true, head: 'dev' })
          }
          const file = path.match(/^\/file\/([a-z0-9][\w.-]*\.geojson)$/i)
          if (req.method === 'GET' && file) {
            const p = join(dir, file[1])
            if (!existsSync(p)) return send(res, 404, { error: 'no such route file' })
            res.setHeader('Content-Type', 'application/geo+json')
            return createReadStream(p).pipe(res)
          }
          if (req.method === 'POST' && path === '/blob') {
            const text = Buffer.from((await readBody(req)).toString('ascii'), 'base64').toString('utf8')
            const sha = createHash('sha1').update(text).digest('hex')
            blobs.set(sha, text)
            return send(res, 201, { sha })
          }
          if (req.method === 'POST' && path === '/commit') {
            const { files } = JSON.parse((await readBody(req)).toString('utf8'))
            for (const f of files) {
              if (!/^[a-z0-9][\w.-]*\.geojson$/i.test(f.name) || !blobs.has(f.sha)) {
                return send(res, 400, { error: `bad file ${f.name}` })
              }
            }
            for (const f of files) {
              writeFileSync(join(dir, f.name), blobs.get(f.sha))
              blobs.delete(f.sha)
            }
            return send(res, 200, { commit: 'dev' })
          }
          send(res, 404, { error: 'not found' })
        } catch (err) {
          send(res, 500, { error: err.message })
        }
      })
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
  plugins: [
    react(),
    datasetRoutes(resolve(dataset, 'routes')),
    devEditApi(resolve(dataset, 'routes')),
    simplifyRouteGeoJSON(),
  ],
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
