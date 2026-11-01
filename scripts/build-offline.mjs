import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.npm_execpath) throw new Error('Run npm run build:offline from web/.')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const build = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build:frontend'], {
  cwd: join(repo, 'web'),
  env: { ...process.env, LOCALFIRST_BUILD_OFFLINE: '1', VITE_OFFLINE_ONLY: 'true', VITE_DOCS_COLLAB: 'off', VITE_UPDATE_LOG: 'off' },
  stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status || 1)
const dist = join(repo, 'dist-offline')
// HTML parsers normalize CRLF/CR to LF before applying inline-script CSP.
// Hash those exact bytes so a Windows checkout cannot block theme boot.
let html = (await readFile(join(dist, 'index.html'), 'utf8')).replace(/\r\n?/g, '\n')
const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`)
const policy = `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'`
html = html.replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`)
await writeFile(join(dist, 'index.html'), html)
async function files(dir, prefix = '') {
  const entries = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const name = `${prefix}/${entry.name}`
    if (entry.isDirectory()) entries.push(...await files(join(dir, entry.name), name))
    else if (name !== '/sw.js') entries.push(name)
  }
  return entries.sort()
}
const assets = await files(dist)
const digest = createHash('sha256')
// Worker lifecycle fixes must create a new build even when app assets match.
digest.update(await readFile(fileURLToPath(import.meta.url)))
for (const asset of assets) { digest.update(asset); digest.update(await readFile(join(dist, asset))) }
const version = digest.digest('hex').slice(0, 16)
await writeFile(join(dist, 'sw.js'), `// Generated offline application asset cache. Documents are in IndexedDB, never here.
const CACHE_NAME = 'localfirst-offline-${version}'
const ASSETS = ${JSON.stringify(assets)}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)))
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Retain older code while old editors are open, including lazy chunks.
    if (!windows.some(client => new URL(client.url).pathname !== '/api/offline-launch')) {
      const keys = await caches.keys()
      await Promise.all(keys.filter(key => (key.startsWith('localfirst-offline-') || key.startsWith('diwan-offline-')) && key !== CACHE_NAME).map(key => caches.delete(key)))
    }
    await self.clients.claim()
  })())
})
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({ cacheVersion: '${version}' })
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || /^\\/(api|v1|_nearby)(\\/|$)/.test(url.pathname)) return
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(url.pathname)
    if (cached) return cached
    if (url.pathname.startsWith('/assets/')) {
      for (const name of await caches.keys()) {
        if ((name.startsWith('localfirst-offline-') || name.startsWith('diwan-offline-')) && name !== CACHE_NAME) {
          const previous = await (await caches.open(name)).match(url.pathname)
          if (previous) return previous
        }
      }
    }
    if (event.request.mode === 'navigate') return await cache.match('/index.html') || Response.error()
    return Response.error()
  }))
})
`)
await writeFile(join(dist, '.localfirst-offline.json'), JSON.stringify({ mode: 'offline-only', assets: assets.length, cacheVersion: version, stage: 'windows-bluetooth-preview' }, null, 2))
console.log(`Offline workspace: ${dist}; ${assets.length} local application assets; internet connections disabled.`)
