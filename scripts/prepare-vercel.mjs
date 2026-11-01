import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rawBackend = process.argv[2] || process.env.LOCALFIRST_BACKEND_URL
if (!rawBackend) {
  throw new Error('Usage: node scripts/prepare-vercel.mjs https://YOUR-SERVICE.up.railway.app')
}
const backend = new URL(rawBackend)
if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') {
  throw new Error('Provide a public HTTPS backend origin with no credentials, query, fragment, or path.')
}
if (backend.hostname === 'localhost' || backend.hostname === '127.0.0.1' || backend.hostname === '[::1]') {
  throw new Error('The Vercel backend must be publicly reachable.')
}

const healthResponse = await fetch(new URL('/healthz', backend), { signal: AbortSignal.timeout(30000) })
if (!healthResponse.ok) throw new Error(`Backend health check failed: ${healthResponse.status}`)
const health = await healthResponse.json()
if (health.status !== 'ok' || typeof health.version !== 'string') throw new Error('The backend did not return a LocalFirst health response.')
const authResponse = await fetch(new URL('/api/auth/status', backend), { signal: AbortSignal.timeout(30000) })
if (!authResponse.ok || (await authResponse.json()).enabled !== true) {
  throw new Error('Enable backend login before publishing the public app.')
}

await readFile(join(repo, 'dist', 'index.html'))
const cloudBuild = JSON.parse(await readFile(join(repo, 'dist', '.localfirst-cloud.json'), 'utf8'))
if (cloudBuild.accountId !== 'self') throw new Error('Run npm run build:cloud from web/ first.')
// Each preparation gets its own folder so stale assets and previous project
// links cannot leak into another deployment.
const output = join(repo, 'deploy', `vercel-${Date.now()}`)
await mkdir(output, { recursive: true })
for (const entry of await readdir(join(repo, 'dist'), { withFileTypes: true })) {
  if (!entry.name.startsWith('.')) await cp(join(repo, 'dist', entry.name), join(output, entry.name), { recursive: true })
}
await writeFile(join(output, 'vercel.json'), JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null,
  buildCommand: null,
  installCommand: null,
  outputDirectory: '.',
  rewrites: [
    { source: '/api/:path*', destination: `${backend.origin}/api/:path*` },
    { source: '/v1/:path*', destination: `${backend.origin}/v1/:path*` },
    { source: '/healthz', destination: `${backend.origin}/healthz` },
    { source: '/version', destination: `${backend.origin}/version` },
    { source: '/:path*', destination: '/index.html' },
  ],
  headers: [
    { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    { source: '/v1/:path*', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    { source: '/index.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
  ],
}, null, 2) + '\n')
console.log(`Vercel upload directory: ${output}`)
