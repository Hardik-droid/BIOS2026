import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (!process.env.npm_execpath) throw new Error('Run this through npm run build:cloud from web/.')
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const build = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build:frontend'], {
  cwd: resolve(repo, 'web'),
  env: { ...process.env, VITE_DEFAULT_ACCOUNT_ID: 'self' },
  stdio: 'inherit',
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status || 1)
writeFileSync(resolve(repo, 'dist', '.localfirst-cloud.json'), JSON.stringify({ accountId: 'self' }))
