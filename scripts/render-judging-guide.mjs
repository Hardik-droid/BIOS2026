import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from '../web/node_modules/marked/lib/marked.esm.js'
import { chromium } from '../web/node_modules/@playwright/test/index.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const directory = join(repo, 'docs', 'judging')
const output = join(directory, 'exports')
const chapters = [
  ['PROJECT-HANDBOOK.md', 'Technical handbook'],
  ['USP-AND-COMPETITIVE-LANDSCAPE.md', 'USP and existing solutions'],
  ['DEMO-AND-DEFENCE.md', 'Presentation and demonstration'],
  ['JUDGES-QUESTIONS-AND-ANSWERS.md', '200 judge questions and model answers'],
]
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const slug = value => value.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')
const toc = []
const files = []
const html = []
const chapterNames = new Map(chapters.map(([name], index) => [name, `part-${index + 1}`]))
let wordCount = 0
let questionCount = 0
for (const [index, [filename, title]] of chapters.entries()) {
  const source = await readFile(join(directory, filename), 'utf8')
  wordCount += source.split(/\s+/).filter(Boolean).length
  if (filename.startsWith('JUDGES-')) questionCount = [...source.matchAll(/^#{2,4}\s+Q(\d{3})\b/gm)].length
  files.push({ file: filename, sha256: createHash('sha256').update(source).digest('hex') })
  const prefix = `part-${index + 1}`
  const counts = new Map()
  const renderer = new marked.Renderer()
  renderer.heading = function({ tokens, depth }) {
    const content = this.parser.parseInline(tokens)
    const base = slug(content)
    const count = counts.get(base) || 0
    counts.set(base, count + 1)
    const id = `${prefix}-${base}${count ? `-${count}` : ''}`
    if (depth <= 2) toc.push({ depth, id, title: content.replace(/<[^>]*>/g, '') })
    return `<h${depth} id="${escape(id)}">${content}</h${depth}>`
  }
  renderer.code = function({ text, lang }) {
    if (lang?.trim() === 'mermaid') return `<pre class="mermaid">${escape(text)}</pre>`
    return `<pre class="code"><code>${escape(text)}</code></pre>`
  }
  renderer.link = function({ href, title, tokens }) {
    let target = href || ''
    const [path, anchor] = target.split('#')
    const name = path.split('/').at(-1)
    if (chapterNames.has(name)) {
      const part = chapterNames.get(name)
      target = anchor ? `#${part}-${anchor}` : `#${part}`
    } else if (target.startsWith('#')) target = `#${prefix}-${target.slice(1)}`
    else if (!/^(https?:|mailto:)/i.test(target)) {
      const absolute = resolve(directory, path)
      const suffix = absolute.slice(repo.length + 1).replaceAll('\\', '/')
      if (absolute.startsWith(repo + '\\') || absolute.startsWith(repo + '/')) {
        target = /experiments\/android-relay\/(app\/src\/main\/java|core-tests)\//.test(suffix)
          ? '#part-1-20-repository-map-and-build-workflow'
          : `https://github.com/Vasu-Gupta105/BIOS2026/blob/d7e9135/${suffix}${anchor ? `#${anchor}` : ''}`
      }
    }
    return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`
  }
  html.push(`<article class="chapter" id="${prefix}"><div class="part-label">Part ${index + 1} · ${escape(title)}</div>${marked.parse(source, { renderer, gfm: true })}</article>`)
}
if (questionCount !== 200) throw new Error(`Expected 200 Q001..Q200 headings; found ${questionCount}.`)
const mermaid = await readFile(join(repo, 'web', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'))
const stylesheet = `
@page { size: A4; }
* { box-sizing:border-box; }
html { color:#1f2937; font-family:Arial,"Segoe UI",sans-serif; font-size:10.3pt; line-height:1.45; }
body { margin:0; }
.cover { min-height:232mm; display:flex; flex-direction:column; justify-content:center; border-top:6px solid #4F46E5; padding:18mm 7mm; }
.eyebrow,.part-label { color:#4338CA; font-size:10pt; font-weight:700; letter-spacing:.09em; text-transform:uppercase; }
.cover h1 { font-size:38pt; line-height:1.1; color:#122e40; margin:10mm 0 5mm; }
.cover .subtitle { font-size:18pt; line-height:1.35; }
.cover .small { margin-top:10mm; color:#475569; font-size:10pt; }
.status-box { margin:9mm 0 0; padding:5mm; background:#f4f7fa; border-left:4px solid #4F46E5; }
.contents,.chapter { break-before:page; }
h1 { color:#122e40; font-size:26pt; line-height:1.2; margin:4mm 0 7mm; }
h2 { color:#133b50; font-size:16pt; line-height:1.25; margin:8mm 0 3mm; }
h3 { color:#163f52; font-size:11.8pt; line-height:1.3; margin:6mm 0 2mm; }
h4 { font-size:10.8pt; margin:4mm 0 2mm; }
h1,h2,h3,h4 { break-after:avoid; }
p { margin:2.5mm 0; orphans:3; widows:3; }
li { margin:1mm 0; orphans:2; widows:2; }
ul,ol { padding-left:6mm; }
a { color:#135772; text-decoration:none; overflow-wrap:anywhere; }
table { border-collapse:collapse; width:100%; margin:4mm 0; font-size:8.8pt; line-height:1.35; table-layout:auto; }
th,td { border:1px solid #d3dce3; padding:2.1mm; text-align:left; vertical-align:top; overflow-wrap:anywhere; }
th { background:#e9f0f5; color:#173c50; font-weight:700; }
table.comparison { table-layout:fixed; }
table.comparison th:first-child,table.comparison td:first-child { width:15%; }
table.comparison th:not(:first-child),table.comparison td:not(:first-child) { width:21.25%; }
thead { display:table-header-group; }
tr { break-inside:avoid; }
blockquote { border-left:3px solid #4F46E5; background:#fbf6ef; margin:4mm 0; padding:2mm 4mm; break-inside:avoid; }
pre.code { white-space:pre-wrap; overflow-wrap:anywhere; background:#f3f5f7; border:1px solid #d7dfe5; padding:3mm; font:8.2pt/1.4 Consolas,monospace; break-inside:avoid; }
code { font-family:Consolas,monospace; font-size:.9em; overflow-wrap:anywhere; }
.mermaid { text-align:center; white-space:normal; break-inside:avoid; margin:5mm 0; }
.mermaid svg { max-width:100%!important; height:auto; }
hr { border:0; border-top:1px solid #dce2e7; margin:6mm 0; }
.toc-list { list-style:none; padding:0; }
.toc-list li { margin:1.5mm 0; }
.toc-list .level-1 { font-size:12pt; font-weight:700; margin-top:4mm; }
.toc-list .level-2 { padding-left:4mm; font-size:9pt; }
img { max-width:100%; }
`
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>BIOS2026 — Project and Judges Guide</title><style>${stylesheet}</style></head><body>
<section class="cover"><div class="eyebrow">Technical documentation · Judge preparation</div><h1>BIOS2026</h1><div class="subtitle">The project, the engineering<br>and the questions judges can ask</div><p>A local-first extension of the LocalFirst office suite</p><div class="status-box"><strong>Evidence-labelled edition · 1 November 2026</strong><p>Windows offline implementation · experimental Android relay · measured long-range and production gates still open</p></div><p class="small">Based on source commit <code>d7e9135</code> and the available local verification reports.<br>Includes a technical handbook, sourced competitor comparison, minute-by-minute demo plan and 200 questions with model answers.</p></section>
<section class="contents"><h1>Contents</h1><p>Use the PDF outline or these links to navigate. Source Markdown files remain the editable project documentation.</p><ul class="toc-list">${toc.map(entry => `<li class="level-${entry.depth}"><a href="#${escape(entry.id)}">${escape(entry.title)}</a></li>`).join('')}</ul></section>
${html.join('\n')}<script src="/mermaid.js"></script><script>document.querySelectorAll('table').forEach(table=>{if(table.querySelector('th')?.textContent.trim()==='Product or family')table.classList.add('comparison')});window.guideReady=false;mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'neutral',fontFamily:'Arial',flowchart:{useMaxWidth:true,htmlLabels:false}});mermaid.run({querySelector:'.mermaid',suppressErrors:false}).then(()=>{window.guideReady=true}).catch(error=>{window.guideError=String(error)});</script></body></html>`
const server = createServer((request, response) => {
  if (request.url === '/mermaid.js') { response.setHeader('Content-Type','application/javascript'); response.end(mermaid); return }
  if (request.url === '/' || request.url === '/favicon.ico') { response.setHeader('Content-Type','text/html; charset=utf-8'); response.end(page); return }
  response.writeHead(404).end()
})
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ channel:'chrome', headless:true })
  const context = await browser.newContext()
  const tab = await context.newPage()
  const errors = []
  const externalRequests = []
  tab.on('pageerror', error => errors.push(error.message))
  await context.route('**/*', async route => {
    if (route.request().url().startsWith(origin+'/')) await route.continue()
    else { externalRequests.push(route.request().url()); await route.abort() }
  })
  await tab.goto(origin, { waitUntil:'networkidle' })
  await tab.waitForFunction(()=>window.guideReady || window.guideError, {timeout:60000})
  const diagramError = await tab.evaluate(()=>window.guideError || '')
  if (diagramError || errors.length || externalRequests.length) throw new Error(JSON.stringify({diagramError,errors,externalRequests}))
  await tab.evaluate(()=>document.fonts.ready)
  const layout = await tab.evaluate(()=>({diagrams:document.querySelectorAll('.mermaid svg').length,questionHeadings:[...document.querySelectorAll('h2,h3,h4')].filter(element=>/^Q\d{3}\b/.test(element.textContent)).length,horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2}))
  if(layout.horizontalOverflow || layout.questionHeadings!==200) throw new Error(`Layout validation failed: ${JSON.stringify(layout)}`)
  await mkdir(output,{recursive:true})
  const pdfPath=join(output,'BIOS2026-Project-and-Judges-Guide.pdf')
  await tab.pdf({path:pdfPath,format:'A4',printBackground:true,displayHeaderFooter:true,preferCSSPageSize:true,tagged:true,outline:true,margin:{top:'17mm',right:'15mm',bottom:'17mm',left:'15mm'},headerTemplate:'<div style="font:8px Arial;color:#64748b;padding:0 15mm;width:100%">BIOS2026 · Project and Judges Guide</div>',footerTemplate:'<div style="font:8px Arial;color:#64748b;padding:0 15mm;width:100%;display:flex;justify-content:space-between"><span>Evidence edition · 1 November 2026</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>'})
  const bytes=await readFile(pdfPath)
  for(const file of files) if(createHash('sha256').update(await readFile(join(directory,file.file))).digest('hex')!==file.sha256) throw new Error(`Source changed while rendering: ${file.file}`)
  const {getDocument}=await import('../web/node_modules/pdfjs-dist/legacy/build/pdf.mjs')
  const pdf=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise
  const pageTexts=[]
  for(let index=1;index<=pdf.numPages;index++) {
    const content=await(await pdf.getPage(index)).getTextContent()
    pageTexts.push(content.items.map(item=>item.str||'').join(' '))
  }
  const pdfIds=[...pageTexts.join('\n').matchAll(/\bQ(\d{3})\./g)].map(match=>Number(match[1]))
  const blankPages=pageTexts.flatMap((text,index)=>text.trim().length<80?[index+1]:[])
  const outline=await pdf.getOutline()
  if(new Set(pdfIds).size!==200 || blankPages.length || !outline?.length) throw new Error(`PDF validation failed: ${JSON.stringify({questions:new Set(pdfIds).size,blankPages,outlineEntries:outline?.length||0})}`)
  const pdfPages=pdf.numPages
  await pdf.destroy()
  const manifest={sourceCommit:'d7e9135',userDate:'2026-11-01',words:wordCount,questions:questionCount,diagrams:layout.diagrams,pdfPages,pdfQuestionsVerified:200,blankPages,pdfOutlinePresent:true,pdfBytes:bytes.length,pdfSha256:createHash('sha256').update(bytes).digest('hex'),markdown:files,externalRenderRequests:externalRequests,browserErrors:errors}
  await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2))
  console.log(JSON.stringify({pdf:pdfPath,...manifest},null,2))
} finally {
  if(browser)await browser.close()
  await new Promise(resolve=>server.close(resolve))
}
