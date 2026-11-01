import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metadata = JSON.parse(await readFile(join(repo, 'dist-offline', '.diwan-offline.json'), 'utf8'))
if (metadata.mode !== 'offline-only') throw new Error('Run npm run build:offline first.')
const output = join(repo, 'offline-package', `windows-x64-${Date.now()}`)
await mkdir(output, { recursive: true })
const portableGo = resolve(repo, '..', '.tools', 'go', 'bin', 'go.exe')
const go = process.env.GO_BINARY || (existsSync(portableGo) ? portableGo : 'go')
const build = spawnSync(go, ['build', '-trimpath', '-ldflags', '-s -w', '-o', join(output, 'diwan-offline.exe'), './cmd/diwan-offline'], {
  cwd: repo, env: { ...process.env, CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'amd64' }, stdio: 'inherit', windowsHide: true,
})
if (build.error) throw build.error
if (build.status !== 0) process.exit(build.status || 1)
await cp(join(repo, 'dist-offline'), join(output, 'web'), { recursive: true })
const nativeVersion = createHash('sha256').update(await readFile(join(output, 'diwan-offline.exe'))).digest('hex').slice(0, 16)
await writeFile(join(output, 'web', '.diwan-offline.json'), JSON.stringify({ ...metadata, nativeVersion, nearbyProtocol: 'windows-rfcomm-v1' }, null, 2))
for (const notice of ['LICENSE-MIT', 'LICENSE-APACHE', 'THIRD-PARTY-NOTICES.txt', 'THIRD-PARTY-NOTICES-GO.txt']) {
  await cp(join(repo, notice), join(output, notice))
}
await mkdir(join(output, 'docs'))
for (const document of ['WINDOWS-BLUETOOTH.md', 'BLUETOOTH-INVITATION-FIX.md', 'BLUETOOTH-HOST-INVITATION-FIX.md', 'OFFLINE-NEARBY-PLAN.md', 'OFFLINE-NEARBY-PROGRESS.md', 'OFFLINE-USER-SAFETY-AUDIT.md']) {
  await cp(join(repo, 'docs', document), join(output, 'docs', document))
}
await writeFile(join(output, 'Start-Diwan-Offline.ps1'), `$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:8765'
$expectedMetadata = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'web\\.diwan-offline.json') -Raw | ConvertFrom-Json
$expectedBuild = $expectedMetadata.cacheVersion
$expectedNative = $expectedMetadata.nativeVersion
$ready = $false
try { $health = Invoke-RestMethod "$url/healthz" -TimeoutSec 2; $ready = $health.server -eq 'diwan-offline' -and $health.cache_version -eq $expectedBuild -and $health.native_version -eq $expectedNative } catch {}
if (-not $ready -and $health.server -eq 'diwan-offline' -and $health.mode -eq 'offline-only') {
    # Replace only a verified Diwan bundle asset server. Documents and open
    # editors live in the browser and are not stopped or modified here.
    $listener = Get-NetTCPConnection -State Listen -LocalAddress '127.0.0.1' -LocalPort 8765 -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listener) { throw 'The old offline server could not be identified. Close its process and try again.' }
    $running = Get-Process -Id $listener.OwningProcess
    if (-not $running.Path -or (Split-Path $running.Path -Leaf) -ne 'diwan-offline.exe') { throw 'Another application is using port 8765. Close that application, then retry.' }
    $runningMarker = Join-Path (Split-Path $running.Path -Parent) 'web\\.diwan-offline.json'
    if (-not (Test-Path -LiteralPath $runningMarker) -or (Get-Content -LiteralPath $runningMarker -Raw | ConvertFrom-Json).mode -ne 'offline-only') { throw 'The existing server is not a verified offline bundle. Close it before continuing.' }
    Stop-Process -Id $running.Id
    Wait-Process -Id $running.Id -Timeout 5 -ErrorAction SilentlyContinue
}
if (-not $ready) {
    $app = Start-Process -FilePath (Join-Path $PSScriptRoot 'diwan-offline.exe') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        if ($app.HasExited) { throw 'The offline app stopped. Port 8765 may already be in use.' }
        try { $health=Invoke-RestMethod "$url/healthz" -TimeoutSec 1; if ($health.server -eq 'diwan-offline' -and $health.cache_version -eq $expectedBuild -and $health.native_version -eq $expectedNative) { $ready=$true; break } } catch {}
        Start-Sleep -Milliseconds 250
    }
}
if (-not $ready) { throw 'The offline app did not start.' }
Start-Process "$url/api/offline-launch"
`)
await writeFile(join(output, 'Start-Diwan-Offline.cmd'), '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Diwan-Offline.ps1"\r\nif errorlevel 1 pause\r\n')
await writeFile(join(output, 'README.txt'), `Diwan offline workspace - Windows Bluetooth preview

Extract the FULL ZIP on BOTH Windows laptops, then double-click Start-Diwan-Offline.cmd. No Node.js, Go installation, cloud login, or internet connection is needed. Keep the web directory beside diwan-offline.exe. Running the launcher directly inside the ZIP will not work.

Documents are stored in the current browser profile's IndexedDB for http://127.0.0.1:8765. Use the same browser/profile and port. Use Export workspace for a backup before clearing browser data. Do not use a private/incognito window for important documents.

Offline help explains saving and recovery. Restore backup adds new copies and keeps existing files. Restore currently accepts Diwan JSON backups up to 32 MiB. See docs/OFFLINE-USER-SAFETY-AUDIT.md for verified scenarios and remaining limits.

Pair the laptops in Windows Bluetooth Settings and verify matching Windows pairing numbers on both. Run this same updated package on both laptops. On the owner laptop, open a document, choose Bluetooth, then Share this document. Give the other laptop the FOUR-DIGIT pairing code (keep any leading zeros), and leave the dialog open. On the second laptop choose Bluetooth sharing, select the paired hosting laptop, enter the four digits, then Connect over Bluetooth. On the owner laptop, verify the requesting laptop's Bluetooth address and choose Allow this laptop within 30 seconds. The other laptop can then Open shared document. See docs/WINDOWS-BLUETOOTH.md for the full procedure.

The short code expires after two minutes, locks after three failed attempts, and can be approved once. Choose Share this document again for a fresh code. It works only over direct, authenticated and encrypted Windows Bluetooth with host approval; the code is not a traffic encryption key. Experimental relays require the full invitation. The established document channel still uses the full certificate pin and random secret with TLS 1.3.

Full invitation fallback: expand Invitation file and full code on the owner laptop and choose Save invitation file, then look in Downloads for diwan-bluetooth-invitation.json (Ctrl+J opens browser downloads). Transfer THAT file to the other laptop and choose Load invitation file. Export workspace produces a document backup. The importer explains wrong files and will not connect with an incomplete or previously rejected full invitation.

From Home, choose Bluetooth sharing, select Document to share, then Open document to share. The document opens with its Bluetooth dialog. Choose Share this document to generate a four-digit code and enable the full invitation fallback. If no documents exist, create a Docs document first.

Inter-laptop transport uses real Windows classic Bluetooth RFCOMM with authenticated/encrypted pairing and a pinned TLS 1.3 invitation. The browser contacts only its own local helper; no Wi-Fi, LAN relay, tunnel or internet server carries document edits. Both copies retain a local Yjs update journal and exchange missing edits after reconnection. A peer acknowledgement follows the receiving journal commit.

This is a Windows-only preview. Radio listening/registration and protocol/editor recovery are tested separately; a full physical two-laptop transfer must still be verified on your devices. Android is not supported yet. This is not a production-certified release. Limits: one document and one peer, source snapshots up to 512 KiB, shared replica data up to 1 MiB, invitation lifetime 30 minutes. Keep workspace backups.

The launcher starts a hidden local helper for bundled assets and Bluetooth. Keep it running for Bluetooth collaboration. Once installation completes, the PWA can reopen from its asset cache for local editing. The launcher serves bundled assets without internet even on first launch.

The launcher opens /api/offline-launch to activate the current app even when an older offline version is cached. It keeps the browser origin, saved documents and existing editor tabs. Save your work before updating; existing editor tabs can be reopened after their work is saved.
`)
console.log(`Windows offline package: ${output}`)
