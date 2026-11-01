import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const alphaId = 'a626efad-4839-4196-9dca-828c784db3ae'
const betaId = 'e4cdd183-2cb7-4859-b2ef-38b2c9dc47a8'
const budgetId = '632bc3e4-f6e0-413b-a060-4b942cf01418'
const folderId = 'cbdf60f0-7475-45b5-a336-38218626dacd'
const deviceId = '3447e2aa-6347-4f35-9ffd-881d444374fe'

test('document zoom and full-window focus mode preserve the saved text', async ({ page }) => {
  await seedExistingWorkspace(page)
  await page.goto(`/docs/${alphaId}`)
  const editor = page.locator('.ProseMirror')
  await expect(editor).toContainText('Saved before the LocalFirst rebrand.')
  await page.getByRole('combobox', { name: 'Zoom percentage', exact: true }).selectOption('125')
  await expect.poll(() => page.locator('.doc-pages').evaluate(element => getComputedStyle(element).zoom)).toBe('1.25')
  await page.getByRole('button', { name: 'Focus writing', exact: true }).click()
  const canvas = page.locator('.lf-editor.is-focused')
  await expect.poll(async () => Math.round((await canvas.boundingBox())!.width)).toBe(page.viewportSize()!.width)
  await expect.poll(async () => Math.round((await canvas.boundingBox())!.height)).toBe(page.viewportSize()!.height)
  await expect(editor).toContainText('Saved before the LocalFirst rebrand.')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Focus writing', exact: true })).toBeVisible()
  await expect(page.locator('.lf-editor.is-focused')).toHaveCount(0)
  await page.reload()
  await expect(editor).toContainText('Saved before the LocalFirst rebrand.')
})

/** Create the former release's exact browser records before loading React.
 * These are fixture documents, not mocked production counts or radio links. */
async function seedExistingWorkspace(page: Page, options: { draft?: boolean; preferences?: boolean } = {}) {
  await page.route('**/compat-seed', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Compatibility fixture</body></html>' }))
  await page.goto('/compat-seed')
  await page.evaluate(async ({ ids, draft, preferences }) => {
    const now = '2026-10-31T12:00:00.000Z'
    const content = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
    const base = { rev: 2, owner: 'self', parent_id: '', starred: false, trashed: false, created_at: now }
    const files = [
      { ...base, id: ids.alpha, type: 'doc', name: 'Alpha notes', content: content('Saved before the LocalFirst rebrand. Keep this text.'), updated_at: now },
      { ...base, id: ids.beta, type: 'doc', name: 'Beta plan', content: content('A second existing plan.'), updated_at: '2026-10-30T12:00:00.000Z' },
      { ...base, id: ids.budget, type: 'sheet', name: 'Budget tracker', content: [{ name: 'Sheet1', celldata: [], config: {} }], updated_at: '2026-10-29T12:00:00.000Z' },
    ]
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('diwan-local-workspace', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('files', { keyPath: 'id' })
        request.result.createObjectStore('folders', { keyPath: 'id' })
        request.result.createObjectStore('metadata', { keyPath: 'key' })
        request.result.createObjectStore('versions', { keyPath: 'id' }).createIndex('file_id', 'file_id')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['files', 'folders', 'metadata', 'versions'], 'readwrite')
      for (const file of files) tx.objectStore('files').add(file)
      tx.objectStore('folders').add({ id: ids.folder, name: 'Existing project folder', parent_id: '', trashed: false, created_at: now })
      tx.objectStore('metadata').add({ key: 'device', id: ids.device, created_at: now })
      tx.objectStore('versions').add({ id: '7d419bc7-daa4-4d35-9fbc-0560b96a48ec', file_id: ids.alpha, name: 'Alpha notes', content: content('An older saved version.'), rev: 1, created_at: now, label: 'Before rebrand' })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    db.close()
    if (draft) {
      const drafts = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('diwan-drafts', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = drafts.transaction('drafts', 'readwrite')
        tx.objectStore('drafts').add({ id: ids.alpha, name: 'Alpha notes', content: content('Recovery draft from before the rebrand.'), ts: Date.now(), token: '635b965c-0a17-4b08-9dd7-ac44a66c0124' })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      drafts.close()
    }
    if (preferences) {
      localStorage.setItem('diwan.theme', 'dark')
      localStorage.setItem('diwan.sidebar', 'mini')
      localStorage.setItem('vulos_default_view', 'grid')
    }
  }, { ids: { alpha: alphaId, beta: betaId, budget: budgetId, folder: folderId, device: deviceId }, draft: !!options.draft, preferences: !!options.preferences })
}

async function storedRecords(page: Page, store = 'files'): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(storeName => new Promise((resolve, reject) => {
    const request = indexedDB.open('diwan-local-workspace')
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(storeName, 'readonly')
      let result: Array<Record<string, unknown>> = []
      tx.objectStore(storeName).getAll().onsuccess = event => { result = (event.target as IDBRequest<typeof result>).result }
      tx.oncomplete = () => { db.close(); resolve(result) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  }), store)
}

const browserErrors = new WeakMap<Page, string[]>()
test.beforeEach(({ page }) => {
  browserErrors.set(page, [])
  page.on('pageerror', error => browserErrors.get(page)!.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && /content security policy|violates[^\n]*directive/i.test(message.text())) browserErrors.get(page)!.push(message.text())
  })
})
test.afterEach(({ page }) => { expect(browserErrors.get(page)).toEqual([]) })

test('the workspace, browser metadata and install identity consistently use LocalFirst', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('LocalFirst')
  await expect(page.getByRole('heading', { name: 'Good work starts here.' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'LocalFirst home', exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText(/\bDiwan\b/i)
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', 'LocalFirst')
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'LocalFirst')
  const manifest = await (await page.request.get('/manifest.webmanifest')).json()
  expect(manifest.name).toBe('LocalFirst')
  expect(manifest.short_name).toBe('LocalFirst')
  expect(manifest.description).not.toMatch(/diwan/i)
  expect(manifest.icons).toEqual(expect.arrayContaining([expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192' })]))
  expect((await page.request.get('/favicon.svg')).ok()).toBe(true)
  for (const name of ['New Document', 'New Spreadsheet', 'New Presentation', 'New Whiteboard', 'Open PDF']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  }
})

test('legacy documents, versions, folders, device identity, preferences and recovery drafts survive the rebrand', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await seedExistingWorkspace(page, { draft: true, preferences: true })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open Alpha notes', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Expand sidebar', exact: true })).toBeVisible()
  expect(await page.evaluate(() => ({ theme: localStorage.getItem('localfirst.theme'), sidebar: localStorage.getItem('localfirst.sidebar'), view: localStorage.getItem('localfirst_default_view'), originalTheme: localStorage.getItem('diwan.theme') }))).toEqual({ theme: 'dark', sidebar: 'mini', view: 'grid', originalTheme: 'dark' })
  expect((await storedRecords(page)).map(file => file.id).sort()).toEqual([alphaId, betaId, budgetId].sort())
  expect((await storedRecords(page, 'metadata'))[0].id).toBe(deviceId)
  expect((await storedRecords(page, 'folders'))[0].id).toBe(folderId)
  expect((await storedRecords(page, 'versions'))[0].label).toBe('Before rebrand')
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await expect.poll(async () => (await page.getByRole('complementary', { name: 'Workspace navigation', exact: true }).boundingBox())?.width).toBe(248)
  await page.screenshot({ path: 'test-results/localfirst-dark.png', fullPage: true })
  await page.getByRole('button', { name: 'Open Alpha notes', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Document content' })
  // Recovery must be resolved before an existing document becomes editable.
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  await expect(editor).toContainText('Saved before the LocalFirst rebrand. Keep this text.')
  await expect(page.getByText('Unsaved changes from a previous session were found.')).toBeVisible()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await expect(editor).toContainText('Recovery draft from before the rebrand.')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await expect.poll(async () => JSON.stringify((await storedRecords(page)).find(file => file.id === alphaId)?.content)).toContain('Recovery draft from before the rebrand.')

  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace', exact: true }).click()
  const exported = JSON.parse(await readFile((await (await downloadEvent).path())!, 'utf8'))
  expect(exported.format).toBe('localfirst-local-workspace')
  exported.format = 'diwan-local-workspace'
  await page.getByLabel('Choose workspace backup', { exact: true }).setInputFiles({ name: 'previous-brand-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
  const restore = page.getByRole('dialog', { name: 'Restore workspace backup', exact: true })
  await expect(restore).toBeVisible()
  await restore.getByRole('button', { name: 'Restore as new copies', exact: true }).click()
  await expect.poll(async () => (await storedRecords(page)).length).toBe(6)
  expect(JSON.stringify((await storedRecords(page)).find(file => file.id === alphaId)?.content)).toContain('Recovery draft from before the rebrand.')
  expect((await storedRecords(page, 'metadata'))[0].id).toBe(deviceId)
})

test('Ctrl+K finds an existing file and opens it using only the keyboard', async ({ page }) => {
  await seedExistingWorkspace(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open Alpha notes', exact: true })).toBeVisible()
  await page.keyboard.press('Control+k')
  const search = page.getByRole('dialog', { name: 'Search your workspace', exact: true })
  await expect(search).toBeVisible()
  const input = search.getByRole('combobox', { name: 'Search files and applications' })
  await expect(input).toBeFocused()
  await input.fill('Alpha notes')
  await expect(search.getByRole('option', { name: 'Alpha notes', exact: true })).toBeVisible()
  await input.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/docs/${alphaId}$`))
  await expect(page.getByRole('textbox', { name: 'Document content' })).toContainText('Saved before the LocalFirst rebrand.')
  await page.keyboard.press('Control+k')
  await expect(search).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(search).toHaveCount(0)
})

test('Home file views sort, filter, favorite, trash and restore the real stored files', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await seedExistingWorkspace(page)
  await page.goto('/?view=all')
  const fileButtons = page.getByRole('button', { name: /^Open (Alpha notes|Beta plan|Budget tracker)$/ })
  await expect(fileButtons).toHaveCount(3)
  await page.getByRole('combobox', { name: 'Sort files', exact: true }).selectOption('name')
  expect(await fileButtons.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Open Alpha notes', 'Open Beta plan', 'Open Budget tracker'])
  await page.getByRole('combobox', { name: 'Filter files by type', exact: true }).selectOption('sheet')
  await expect(fileButtons).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Open Budget tracker', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: 'Filter files by type', exact: true }).selectOption('all')
  await page.getByRole('button', { name: 'Actions for Alpha notes', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add to favorites', exact: true }).click()
  await page.getByRole('button', { name: 'Favorites', exact: true }).click()
  await expect(fileButtons).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Open Alpha notes', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Actions for Alpha notes', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Move to trash', exact: true }).click()
  await page.goto('/?view=trash')
  await expect(page.getByRole('button', { name: 'Open Alpha notes', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Actions for Alpha notes', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Restore file', exact: true }).click()
  await page.goto('/?view=favorites')
  await expect(page.getByRole('button', { name: 'Open Alpha notes', exact: true })).toBeEnabled()
  const alpha = (await storedRecords(page)).find(file => file.id === alphaId)
  expect(alpha?.starred).toBe(true)
  expect(alpha?.trashed).toBe(false)
  await page.goto('/?view=all')
  await page.screenshot({ path: 'test-results/localfirst-desktop.png', fullPage: true })
})

test('light, dark and system themes and the default file layout work through Settings', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/settings?section=appearance')
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Light theme', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'System theme', exact: true }).click()
  await expect(page.getByRole('button', { name: 'System theme', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'grid', exact: true }).click()
  await page.goto('/docs')
  await expect(page.getByRole('button', { name: 'Grid view', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => localStorage.getItem('localfirst.theme'))).toBe('system')
})

test('mobile navigation and desktop collapse work without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedExistingWorkspace(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Open Alpha notes', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Navigation', exact: true })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('link', { name: 'Documents', exact: true }).click()
  await expect(page).toHaveURL(/\/docs$/)
  await expect(drawer).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New Document', exact: true }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await page.screenshot({ path: 'test-results/localfirst-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  const sidebar = page.getByRole('complementary', { name: 'Workspace navigation', exact: true })
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(72)
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await expect.poll(async () => (await sidebar.boundingBox())?.width).toBe(248)
})
