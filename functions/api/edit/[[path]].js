// Edit-mode backend for the deployed site (Cloudflare Pages Function).
//
// Stop edits are committed to the dataset's route files in GitHub, so git stays
// the single source of truth and each save redeploys like any other push. The
// browser does all the GeoJSON work: route files run to 12 MB, and parsing or
// re-encoding one would blow a Function's CPU budget, so this file only ever
// relays bytes between the browser and the GitHub API.
//
//   GET  /api/edit               → { enabled, head }  (current branch head sha)
//   GET  /api/edit/file/<name>   → raw route file at ?ref=<sha>
//   POST /api/edit/blob          ← base64 file content  → { sha }
//   POST /api/edit/commit        ← { parent, message, files: [{ name, sha }] }
//                                → { commit }, or 409 if the branch moved
//
// Off unless every variable below is set — without them each request is a
// 404 and the app never shows its edit button. Because this endpoint can write
// to the repo, it also refuses any request that doesn't carry a valid
// Cloudflare Access token for this application: an Access policy in front of
// the site is required, not optional.
//
//   GITHUB_TOKEN        fine-grained PAT: Contents read/write on GITHUB_REPO only
//   GITHUB_REPO         owner/name of the repo holding the dataset
//   GITHUB_BRANCH       branch Pages deploys from (default: main)
//   ROUTES_DIR          route files' dir in the repo (default: data/routes)
//   ACCESS_TEAM_DOMAIN  e.g. myteam.cloudflareaccess.com
//   ACCESS_AUD          the Access application's Audience (AUD) tag

const FILE_RE = /^[a-z0-9][\w.-]*\.geojson$/i
const SHA_RE  = /^[0-9a-f]{40}$/

export async function onRequest({ request, env, params }) {
  const cfg = config(env)
  if (!cfg) return json(404, { enabled: false })

  if (!(await accessTokenValid(request, cfg))) return json(403, { error: 'Cloudflare Access token missing or invalid' })

  const path = (params.path ?? []).join('/')
  try {
    if (request.method === 'GET' && path === '') {
      const ref = await gh(cfg, `git/ref/heads/${cfg.branch}`)
      return json(200, { enabled: true, head: ref.object.sha })
    }

    if (request.method === 'GET' && path.startsWith('file/')) {
      const name = path.slice(5)
      const ref  = new URL(request.url).searchParams.get('ref')
      if (!FILE_RE.test(name) || !SHA_RE.test(ref ?? '')) return json(400, { error: 'bad file or ref' })
      // The raw media type streams the file itself (up to 100 MB) — the JSON
      // form of the contents API stops at 1 MB.
      const res = await ghFetch(cfg, `contents/${cfg.routesDir}/${name}?ref=${ref}`, {
        headers: { Accept: 'application/vnd.github.raw+json' },
      })
      if (!res.ok) return json(res.status, { error: `GitHub ${res.status}` })
      return new Response(res.body, { headers: { 'Content-Type': 'application/geo+json', 'Cache-Control': 'no-store' } })
    }

    if (request.method === 'POST' && path === 'blob') {
      // Wrap the base64 body in the blob API's JSON without decoding it: a
      // Blob of parts is concatenated natively, costing no script CPU.
      const body = new Blob(['{"encoding":"base64","content":"', await request.arrayBuffer(), '"}'])
      const blob = await gh(cfg, 'git/blobs', { method: 'POST', body })
      return json(201, { sha: blob.sha })
    }

    if (request.method === 'POST' && path === 'commit') {
      const { parent, message, files } = await request.json()
      if (!SHA_RE.test(parent ?? '') || typeof message !== 'string' || !Array.isArray(files) || !files.length ||
          files.some(f => !FILE_RE.test(f?.name ?? '') || !SHA_RE.test(f?.sha ?? ''))) {
        return json(400, { error: 'bad commit request' })
      }
      const base = await gh(cfg, `git/commits/${parent}`)
      const tree = await gh(cfg, 'git/trees', {
        method: 'POST',
        body: JSON.stringify({
          base_tree: base.tree.sha,
          tree: files.map(f => ({ path: `${cfg.routesDir}/${f.name}`, mode: '100644', type: 'blob', sha: f.sha })),
        }),
      })
      const commit = await gh(cfg, 'git/commits', {
        method: 'POST',
        body: JSON.stringify({ message, tree: tree.sha, parents: [parent] }),
      })
      // Not forced: if anything was pushed since the editor loaded `parent`,
      // this isn't a fast-forward and GitHub refuses it instead of clobbering.
      const res = await ghFetch(cfg, `git/refs/heads/${cfg.branch}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      })
      if (res.status === 422) return json(409, { error: 'The branch has moved on since editing started — reload and redo the changes.' })
      if (!res.ok) return json(502, { error: `GitHub ${res.status} updating the branch` })
      return json(200, { commit: commit.sha })
    }

    return json(404, { error: 'not found' })
  } catch (err) {
    return json(502, { error: err.message })
  }
}

function config(env) {
  const { GITHUB_TOKEN, GITHUB_REPO, ACCESS_TEAM_DOMAIN, ACCESS_AUD } = env
  if (!GITHUB_TOKEN || !GITHUB_REPO || !ACCESS_TEAM_DOMAIN || !ACCESS_AUD) return null
  return {
    token:     GITHUB_TOKEN,
    repo:      GITHUB_REPO,
    branch:    env.GITHUB_BRANCH || 'main',
    routesDir: (env.ROUTES_DIR || 'data/routes').replace(/^\/|\/$/g, ''),
    team:      ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    aud:       ACCESS_AUD,
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function ghFetch(cfg, path, init = {}) {
  return fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'travel-map-editor',
      ...init.headers,
    },
  })
}

async function gh(cfg, path, init) {
  const res = await ghFetch(cfg, path, init)
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path.split('?')[0]}`)
  return res.json()
}

// ── Cloudflare Access JWT (RS256) ────────────────────────────────────────────
// Access puts a signed token on every request it lets through; checking it
// here means a misconfigured or removed Access policy fails closed.

let certCache = null // { team, keys: Map<kid, CryptoKey>, at }

async function signingKey(team, kid) {
  const fresh = certCache?.team === team && Date.now() - certCache.at < 3600_000
  if (!fresh || !certCache.keys.has(kid)) {
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`)
    if (!res.ok) return null
    const { keys } = await res.json()
    const map = new Map()
    for (const jwk of keys) {
      map.set(jwk.kid, await crypto.subtle.importKey(
        'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']))
    }
    certCache = { team, keys: map, at: Date.now() }
  }
  return certCache.keys.get(kid) ?? null
}

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}

async function accessTokenValid(request, cfg) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const header  = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0])))
    const payload = JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])))
    if (header.alg !== 'RS256') return false
    const key = await signingKey(cfg.team, header.kid)
    if (!key) return false
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key,
      b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
    if (!ok) return false
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
    const now = Date.now() / 1000
    return aud.includes(cfg.aud) && payload.iss === `https://${cfg.team}` && payload.exp > now
  } catch {
    return false
  }
}
