import { test, expect, type Page } from '@playwright/test'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

// These cases exercise the real bundled engines and real IndexedDB commits.
// There are no HTTP, workbook, canvas, or editor stubs in this file.
test.setTimeout(90000)

const pageErrors = new WeakMap<Page, string[]>()
const consoleErrors = new WeakMap<Page, string[]>()
const forbiddenRequests = new WeakMap<Page, string[]>()
test.beforeEach(({ page, context, baseURL }) => {
  pageErrors.set(page, []); consoleErrors.set(page, []); forbiddenRequests.set(page, [])
  page.on('pageerror', error => pageErrors.get(page)!.push(error.message))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.get(page)!.push(message.text()) })
  context.on('request', request => {
    const url = new URL(request.url())
    if (['http:', 'https:'].includes(url.protocol) && (url.origin !== new URL(baseURL!).origin || /^\/(api|v1)(\/|$)/.test(url.pathname))) forbiddenRequests.get(page)!.push(request.url())
  })
})
test.afterEach(({ page }) => {
  expect(pageErrors.get(page)).toEqual([])
  expect(forbiddenRequests.get(page)).toEqual([])
  const unexpected = consoleErrors.get(page)!.filter(message => !/404 \(Not Found\)/.test(message))
  expect(unexpected).toEqual([])
})

async function create(page: Page, path: string, buttonName: string, name: string): Promise<string> {
  await page.goto(path)
  await page.getByRole('button', { name: buttonName, exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${path}/[^/]+$`))
  return new URL(page.url()).pathname.split('/').pop()!
}

async function storedFile(page: Page, id: string): Promise<Record<string, unknown>> {
  return page.evaluate(fileId => new Promise((resolve, reject) => {
    const request = indexedDB.open('diwan-local-workspace')
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('files', 'readonly')
      let file: Record<string, unknown>
      tx.objectStore('files').get(fileId).onsuccess = event => { file = (event.target as IDBRequest<typeof file>).result }
      tx.oncomplete = () => { db.close(); resolve(file) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  }), id)
}

test('the actual spreadsheet engine edits a cell, saves its title and reloads the committed workbook', async ({ page }) => {
  const id = await create(page, '/sheets', 'New Spreadsheet', 'Engine workbook')
  await expect(page.getByLabel('Sheet title')).toHaveValue('Engine workbook', { timeout: 60000 })
  const overlay = page.locator('.fortune-sheet-overlay').first()
  await expect(overlay).toBeVisible({ timeout: 60000 })
  await expect(page.locator('.fortune-sheet-container canvas').first()).toBeVisible()
  await overlay.click({ position: { x: 60, y: 40 } })
  const formulaInput = page.locator('.fortune-fx-input')
  await expect(formulaInput).toHaveAttribute('contenteditable', 'true')
  await formulaInput.click()
  // Fortune exposes the cell editor above its canvas only after edit mode is
  // initialized. The formula field's raw DOM alone is not a commit-ready signal.
  await expect(page.locator('.luckysheet-input-box')).toHaveCSS('z-index', '19')
  // Fortune's formula editor mirrors keystrokes using KeyboardEvent metadata;
  // fill() alone does not exercise the same commit path as a person typing.
  await formulaInput.pressSequentially('LocalFirst workbook cell', { delay: 20 })
  await expect(formulaInput).toContainText('LocalFirst workbook cell')
  await expect(page.locator('#luckysheet-rich-text-editor')).toContainText('LocalFirst workbook cell')
  await formulaInput.press('Enter')
  try {
    await expect.poll(async () => JSON.stringify((await storedFile(page, id)).content).includes('LocalFirst workbook cell'), { timeout: 20000 }).toBe(true)
  } catch (error) {
    const record = await storedFile(page, id)
    const sheets = (Array.isArray(record.content) ? record.content : []) as Array<Record<string, unknown>>
    const summary = sheets.map(sheet => ({
      keys: Object.keys(sheet),
      celldata: sheet.celldata,
      matrix: Array.isArray(sheet.data) ? sheet.data.flatMap((row, r) => Array.isArray(row) ? row.flatMap((value, c) => value == null ? [] : [{ r, c, value }]) : []) : undefined,
    }))
    console.log('SHEET_PERSISTENCE_DIAGNOSTIC', JSON.stringify({ name: record.name, rev: record.rev, sheets: summary }))
    await test.info().attach('spreadsheet-persisted-record.json', { body: Buffer.from(JSON.stringify(record)), contentType: 'application/json' })
    throw error
  }
  await page.getByLabel('Sheet title').fill('LocalFirst workbook saved')
  await page.keyboard.press('Control+s')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => JSON.stringify((await storedFile(page, id)).content).includes('LocalFirst workbook cell'), { timeout: 20000 }).toBe(true)
  await expect.poll(async () => (await storedFile(page, id)).name).toBe('LocalFirst workbook saved')
  await page.reload()
  await expect(page.getByLabel('Sheet title')).toHaveValue('LocalFirst workbook saved', { timeout: 60000 })
  await expect(overlay).toBeVisible()
  expect(JSON.stringify((await storedFile(page, id)).content)).toContain('LocalFirst workbook cell')
  await overlay.click({ position: { x: 60, y: 40 } })
  await expect(page.locator('.fortune-fx-input')).toContainText('LocalFirst workbook cell')
})

test('the actual slide canvas edits a text object, adds a slide and reloads the saved deck', async ({ page }) => {
  const id = await create(page, '/slides', 'New Presentation', 'Engine presentation')
  await expect(page.getByLabel('Presentation title')).toHaveValue('Engine presentation', { timeout: 60000 })
  await expect(page.getByRole('group', { name: 'Slide canvas', exact: true })).toBeVisible()
  await page.getByLabel('Presentation title').fill('LocalFirst presentation saved')
  await page.getByLabel('Slide title', { exact: true }).fill('A real slide title')
  await page.getByRole('button', { name: 'Insert text box', exact: true }).click()
  const textEditor = page.locator('[data-object-text-editor] .ProseMirror').first()
  await expect(textEditor).toBeVisible()
  await textEditor.fill('LocalFirst slide text survives reload')
  await page.keyboard.press('Escape')
  await page.getByLabel('Add slide', { exact: true }).click()
  await expect(page.getByLabel(/^Slide 2/).first()).toBeVisible()
  await page.keyboard.press('Control+s')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => JSON.stringify((await storedFile(page, id)).content), { timeout: 20000 }).toContain('LocalFirst slide text survives reload')
  expect(((await storedFile(page, id)).content as { slides: unknown[] }).slides).toHaveLength(2)
  await page.reload()
  await expect(page.getByLabel('Presentation title')).toHaveValue('LocalFirst presentation saved', { timeout: 60000 })
  await expect(page.getByRole('group', { name: 'Slide canvas', exact: true })).toBeVisible()
  await expect(page.getByLabel('Slide title', { exact: true })).toHaveValue('A real slide title')
  await expect(page.getByRole('group', { name: 'Slide canvas', exact: true })).toContainText('LocalFirst slide text survives reload')
  expect(((await storedFile(page, id)).content as { slides: unknown[] }).slides).toHaveLength(2)
})

test('the actual whiteboard canvas draws a rectangle and persists its scene and title across reload', async ({ page }) => {
  const id = await create(page, '/whiteboards', 'New Whiteboard', 'Engine whiteboard')
  await expect(page.getByTestId('whiteboard-editor')).toBeVisible({ timeout: 60000 })
  const canvas = page.locator('.excalidraw__canvas.interactive')
  await expect(canvas).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('status', { name: 'Opening whiteboard…', exact: true })).toHaveCount(0)
  await page.getByLabel('Whiteboard title').fill('LocalFirst whiteboard saved')
  // Excalidraw's visible tool icon covers its native radio; users select the label.
  await page.locator('label').filter({ has: page.getByTestId('toolbar-rectangle') }).click()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('The real Excalidraw canvas has no geometry.')
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.65, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.press('Escape')
  await page.getByLabel('Whiteboard title').focus()
  await page.keyboard.press('Control+s')
  // The whiteboard's documented persistence path is its scene autosave.
  await expect.poll(async () => ((await storedFile(page, id)).content as { elements: Array<{ type: string }> }).elements.filter(element => element.type === 'rectangle').length, { timeout: 20000 }).toBe(1)
  await expect.poll(async () => (await storedFile(page, id)).name).toBe('LocalFirst whiteboard saved')
  await page.reload()
  await expect(page.getByLabel('Whiteboard title')).toHaveValue('LocalFirst whiteboard saved', { timeout: 60000 })
  await expect(canvas).toBeVisible()
  await expect(page.getByRole('status', { name: 'Opening whiteboard…', exact: true })).toHaveCount(0)
  const elements = ((await storedFile(page, id)).content as { elements: Array<{ type: string; width: number; height: number }> }).elements
  expect(elements).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'rectangle', width: expect.any(Number), height: expect.any(Number) })]))
  expect(elements.find(element => element.type === 'rectangle')!.width).toBeGreaterThan(20)
})

test('the actual PDF engine imports a generated page, renders pixels, zooms and navigates an inserted page offline', async ({ page }) => {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  pdf.addPage([400, 500]).drawText('LocalFirst PDF engine acceptance', { x: 30, y: 435, size: 16, font, color: rgb(0.05, 0.1, 0.2) })
  await page.goto('/')
  await page.getByLabel('Open a PDF file', { exact: true }).setInputFiles({ name: 'localfirst-engine.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
  await expect(page).toHaveURL(/\/pdf-editor$/, { timeout: 60000 })
  await expect(page.getByLabel('PDF filename')).toHaveValue('localfirst-engine.pdf', { timeout: 60000 })
  const status = page.locator('.lf-editor-pdf [aria-label="Editor information"]')
  await expect(status).toContainText(/Page:\s*1\s*\/\s*1/)
  const canvas = page.locator('.lf-editor-pdf canvas[class="block"]')
  await expect(canvas).toBeVisible()
  const darkPixels = () => canvas.evaluate((element: HTMLCanvasElement) => {
    const data = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data
    let count = 0
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0 && data[i] < 170 && data[i + 1] < 170 && data[i + 2] < 170) count++
    return count
  })
  await expect.poll(darkPixels, { timeout: 20000 }).toBeGreaterThan(20)
  const initialWidth = await canvas.evaluate((element: HTMLCanvasElement) => element.width)
  await page.getByRole('button', { name: 'Zoom in (+)', exact: true }).click()
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(initialWidth)
  await expect.poll(darkPixels).toBeGreaterThan(20)
  await page.getByRole('button', { name: 'Blank', exact: true }).click()
  await expect(status).toContainText('/ 2')
  await page.getByRole('button', { name: 'Select (V)', exact: true }).click()
  await canvas.click({ position: { x: 10, y: 10 } })
  await page.keyboard.press('ArrowLeft')
  await expect(status).toContainText('1 / 2')
  await page.keyboard.press('ArrowRight')
  await expect(status).toContainText('2 / 2')
  await page.keyboard.press('ArrowLeft')
  await expect(status).toContainText('1 / 2')
  await expect.poll(darkPixels).toBeGreaterThan(20)
})
