#!/usr/bin/env node
/**
 * Rebuild every LocalFirst browser/PWA image from brand/logo.svg.
 * Run from the repository root: node scripts/gen-logo-assets.mjs
 * Uses the project's installed Playwright and local Chrome; no remote assets.
 */
import { chromium } from '../web/node_modules/@playwright/test/index.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = path.join(repo, 'web', 'public')
const canonical = await readFile(path.join(repo, 'brand', 'logo.svg'), 'utf8')
if (!canonical.includes('viewBox="0 0 64 64"') || !canonical.includes('<title id="localfirst-title">LocalFirst</title>')) throw new Error('The canonical LocalFirst mark is missing or invalid.')
const mark = canonical.match(/<g id="mark">([\s\S]*?)<\/g>/)?.[1]
if (!mark) throw new Error('The canonical SVG must contain a mark group.')
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#4F46E5"/><g transform="translate(4.8 4.8) scale(.85)">${mark}</g></svg>`
await mkdir(path.join(publicDir, 'icons'), { recursive: true })
await writeFile(path.join(publicDir, 'logo.svg'), canonical)
await writeFile(path.join(publicDir, 'favicon.svg'), canonical.replace('width="512" height="512"', 'width="32" height="32"'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 1 })
let externalRequests = 0
await page.route(/^https?:/, route => { externalRequests++; return route.abort() })
async function raster(svg, size, destination) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`)
  await page.locator('svg').screenshot({ path: destination, omitBackground: true })
}
try {
  for (const size of [16, 32, 48, 96]) await raster(canonical, size, path.join(publicDir, `favicon-${size}x${size}.png`))
  for (const [file, size] of [['icons/icon-192.png', 192], ['icons/icon-512.png', 512], ['android-chrome-192x192.png', 192], ['android-chrome-512x512.png', 512], ['apple-touch-icon.png', 180]]) await raster(fullBleed, size, path.join(publicDir, file))
  await raster(canonical, 512, path.join(repo, 'docs', 'assets', 'localfirst-logo.png'))
  // PNG-backed ICO is supported by modern Windows and browser favicon readers.
  const pngs = await Promise.all([16, 32, 48, 96].map(size => readFile(path.join(publicDir, `favicon-${size}x${size}.png`))))
  const header = Buffer.alloc(6 + pngs.length * 16)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach((png, index) => {
    const entry = 6 + index * 16, size = [16, 32, 48, 96][index]
    header.writeUInt8(size, entry); header.writeUInt8(size, entry + 1)
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8); header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  await writeFile(path.join(publicDir, 'favicon.ico'), Buffer.concat([header, ...pngs]))
  const font = (await readFile(path.join(repo, 'web', 'node_modules', '@fontsource-variable', 'inter', 'files', 'inter-latin-wght-normal.woff2'))).toString('base64')
  await page.setViewportSize({ width: 1200, height: 630 })
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face{font-family:Inter;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
    *{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;font-family:Inter,sans-serif;color:#15362d}
    .stage{position:relative;width:1200px;height:630px;padding:64px;background:#f6f8f6;overflow:hidden}
    .brand{display:flex;align-items:center;gap:16px;font-size:32px;font-weight:650;letter-spacing:-1.2px}.brand svg{width:52px;height:52px}
    h1{font-size:76px;line-height:1.08;letter-spacing:-4.5px;font-weight:600;margin:64px 0 24px}
    .intro{max-width:465px;color:#66766e;font-size:22px;line-height:1.55;margin:0}
    .apps{position:absolute;bottom:55px;left:64px;font-size:14px;letter-spacing:.03em;color:#66766e}
    .workspace{position:absolute;right:56px;top:72px;width:430px;height:485px;border:1px solid #d9e3dc;border-radius:18px;background:#fff;box-shadow:0 24px 70px #4F46E513;overflow:hidden;transform:rotate(-3deg)}
    .toolbar{height:54px;border-bottom:1px solid #e6ece7;display:flex;align-items:center;gap:6px;padding:0 20px;color:#7c8b82;font-size:11px}.dot{width:7px;height:7px;border-radius:50%;background:#d8e3dc}.toolbar span:last-child{margin-left:auto}
    .content{padding:30px}.eyebrow{font-size:10px;letter-spacing:1.7px;color:#7b8d81;font-weight:600}.content h2{font-size:26px;letter-spacing:-1px;margin:12px 0 20px;font-weight:600}.create{display:flex;gap:10px;margin-bottom:29px}.tile{flex:1;border:1px solid #e4ece6;border-radius:10px;height:96px;padding:12px;background:#fafcf9;font-size:11px;color:#52685b}.glyph{font-size:24px;display:block;margin-bottom:7px;color:#277c57}.row{display:flex;align-items:center;gap:12px;border-bottom:1px solid #edf1ee;height:55px;font-size:12px;color:#52685b}.docicon{width:27px;height:32px;border:1px solid #c5dacf;border-radius:4px;background:#eff6f1;position:relative}.docicon:after{content:'';position:absolute;left:7px;right:7px;top:11px;height:1px;background:#98bca7;box-shadow:0 5px #98bca7}.row span:last-child{margin-left:auto;color:#91a094;font-size:10px}.status{position:absolute;bottom:19px;left:30px;color:#769180;font-size:10px;display:flex;align-items:center;gap:6px}.status:before{content:'';width:5px;height:5px;border-radius:50%;background:#277c57}
  </style></head><body><div class="stage">
    <div class="brand">${canonical}<span>LocalFirst</span></div>
    <h1>Your work.<br>Your space.</h1>
    <p class="intro">A thoughtful home for your documents,<br>ideas and everything in between.</p>
    <div class="apps">Documents &nbsp;·&nbsp; Sheets &nbsp;·&nbsp; Slides &nbsp;·&nbsp; Whiteboards &nbsp;·&nbsp; PDF</div>
    <div class="workspace"><div class="toolbar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span>Your workspace</span></div><div class="content"><div class="eyebrow">A PLACE TO BEGIN</div><h2>Make room for your ideas.</h2><div class="create"><div class="tile"><span class="glyph">▤</span>Document</div><div class="tile"><span class="glyph">▦</span>Spreadsheet</div><div class="tile"><span class="glyph">▱</span>Whiteboard</div></div><div class="eyebrow">MADE FOR YOUR NEXT IDEA</div><div class="row"><i class="docicon"></i>A fresh perspective<span>Document</span></div><div class="row"><i class="docicon"></i>The next chapter<span>Document</span></div><div class="row"><i class="docicon"></i>Room to explore<span>Whiteboard</span></div></div><div class="status">A space that feels like yours</div></div>
  </div></body></html>`, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.locator('.stage').screenshot({ path: path.join(publicDir, 'og-image.png') })
  if (externalRequests) throw new Error('Asset generation attempted external requests.')
  console.log(JSON.stringify({ brand: 'LocalFirst', favicons: [16, 32, 48, 96], pwa: [180, 192, 512], og: [1200, 630], externalRequests }))
} finally { await browser.close() }
