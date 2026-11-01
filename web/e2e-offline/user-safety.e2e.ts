import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const network = new WeakMap<Page, string[]>()
const errors = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page, context }) => {
  network.set(page, []); errors.set(page, [])
  page.on('dialog', dialog => void dialog.accept())
  page.on('pageerror', error => errors.get(page)!.push(error.message))
  context.on('request', request => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' || /^\/(api|v1)(\/|$)/.test(url.pathname)) network.get(page)!.push(request.url())
  })
})
test.afterEach(async ({ page }) => {
  expect(network.get(page)).toEqual([])
  expect(errors.get(page)).toEqual([])
})
async function create(page: Page, name: string): Promise<string> {
  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Document content' })).toHaveAttribute('contenteditable', 'true')
  return new URL(page.url()).pathname.split('/').pop()!
}
async function records(page: Page, store = 'files', database = 'diwan-local-workspace'): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(({ store, database }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(database)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(store, 'readonly')
      let result: Array<Record<string, unknown>> = []
      tx.objectStore(store).getAll().onsuccess = event => { result = (event.target as IDBRequest<typeof result>).result }
      tx.oncomplete = () => { db.close(); resolve(result) }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  }), { store, database })
}
async function upload(page: Page, json: string, name = 'backup.json'): Promise<void> {
  await page.getByLabel('Choose workspace backup', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(json) })
}

test('a downloaded backup can be reviewed and restored without replacing newer local work', async ({ page }) => {
  const id = await create(page, 'My beginner backup')
  const editor = page.getByRole('textbox', { name: 'Document content' })
  await editor.fill('Saved before backup हिन्दी العربية 🙂')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace', exact: true }).click()
  const download = await downloadEvent
  const json = await readFile((await download.path())!, 'utf8')
  await editor.fill('Newer local work must survive restore')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await upload(page, json)
  const preview = page.getByRole('dialog', { name: 'Restore workspace backup' })
  await expect(preview).toContainText('1 file(s)')
  await preview.getByRole('button', { name: 'Restore as new copies' }).click()
  await expect(page.getByText(/Restored 1 file\(s\)/)).toBeVisible()
  const saved = await records(page)
  expect(saved).toHaveLength(2)
  expect(JSON.stringify(saved.find(file => file.id === id)?.content)).toContain('Newer local work')
  expect(JSON.stringify(saved.find(file => file.id !== id)?.content)).toContain('हिन्दी العربية 🙂')
  await expect(editor).toContainText('Newer local work')
})

test('corrupt backups fail visibly without changing files', async ({ page }) => {
  await create(page, 'Keep my work')
  await upload(page, '{not valid JSON', 'broken.json')
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a valid LocalFirst' })).toBeVisible()
  expect(await records(page)).toHaveLength(1)
  await expect(page.getByRole('dialog', { name: 'Restore workspace backup' })).toHaveCount(0)
})

test('full storage and unavailable drafts still offer a downloadable, restorable recovery copy', async ({ page }) => {
  await create(page, 'Full device')
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'files' || this.name === 'drafts') throw new DOMException('Storage full', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
  await page.getByRole('textbox', { name: 'Document content' }).fill('Emergency copy survives a completely full local store')
  const alert = page.getByRole('alert').filter({ hasText: 'Your latest changes have not been saved' })
  await expect(alert).toContainText('device storage is full')
  const event = page.waitForEvent('download')
  await alert.getByRole('button', { name: 'Download recovery copy' }).click()
  const recovery = await readFile((await (await event).path())!, 'utf8')
  expect(recovery).toContain('Emergency copy survives')
  await page.reload()
  await upload(page, recovery, 'recovery.json')
  await page.getByRole('dialog', { name: 'Restore workspace backup' }).getByRole('button', { name: 'Restore as new copies' }).click()
  await expect.poll(async () => JSON.stringify(await records(page))).toContain('Emergency copy survives')
})

test('leaving immediately after typing keeps the latest edit recoverable', async ({ page }) => {
  const id = await create(page, 'Quick navigation')
  await page.evaluate(() => {
    const original = window.setTimeout
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => original(callback, delay === 250 ? 60000 : delay, ...args)) as typeof window.setTimeout
  })
  await page.getByRole('textbox', { name: 'Document content' }).fill('This edit happened just before leaving')
  await expect(page.getByText('Unsaved', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to Docs', exact: true }).click()
  await expect(page).toHaveURL(/\/docs$/)
  await expect.poll(async () => JSON.stringify(await records(page, 'drafts', 'diwan-drafts'))).toContain('just before leaving')
  await page.goto(`/docs/${id}`)
  await expect(page.getByText('Unsaved changes from a previous session were found.')).toBeVisible()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Document content' })).toContainText('just before leaving')
})

test('storage denial is not mistaken for an empty workspace and can be retried', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { storageBlocked: true })
    const original = indexedDB.open.bind(indexedDB)
    indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
      if (Reflect.get(window, 'storageBlocked')) throw new DOMException('Browser storage access is blocked. Allow site storage, then retry.', 'SecurityError')
      return original(...args)
    }) as IDBFactory['open']
  })
  await page.goto('/docs')
  await expect(page.getByText('Local storage unavailable', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Your files could not be opened' })).toBeVisible()
  await expect(page.getByText('No documents yet', { exact: true })).toHaveCount(0)
  await page.evaluate(() => Reflect.set(window, 'storageBlocked', false))
  await page.getByRole('button', { name: 'Retry storage' }).click()
  await page.getByRole('button', { name: 'Try opening files again' }).click()
  await expect(page.getByText('Local workspace · Internet access disabled')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('denied storage protection and low space receive honest actionable feedback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'storage', { value: { persisted: async () => false, persist: async () => false, estimate: async () => ({ usage: 95, quota: 100 }) } })
  })
  await page.goto('/docs')
  await expect(page.getByText(/Local storage is nearly full/)).toBeVisible()
  await page.getByRole('button', { name: 'Keep data on this device' }).click()
  await expect(page.getByText(/browser did not allow storage protection/)).toBeVisible()
  await expect(page.getByText('Storage protection allowed', { exact: true })).toHaveCount(0)
})

test('small screens retain save status, useful controls and a keyboard-accessible help dialog under CPU throttling', async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await create(page, 'Small screen')
  await page.getByRole('textbox', { name: 'Document content' }).fill('Editing on a small screen, العربية हिन्दी 🙂')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: /Share — with people/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Comments', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  const help = page.getByRole('button', { name: 'Offline help', exact: true })
  await help.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Using LocalFirst offline' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Got it' })).toBeInViewport()
  await dialog.getByRole('button', { name: 'Got it' }).focus()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(help).toBeFocused()
  await page.screenshot({ path: 'test-results/offline-small-screen.png', fullPage: true })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
})

test('a missing document fails visibly and never enables editing or saving a blank replacement', async ({ page }) => {
  await page.goto('/docs/does-not-exist')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not open this document' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Document content' })).toHaveAttribute('contenteditable', 'false')
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
})

test('permanent deletion needs confirmation and Cancel preserves the file', async ({ page }) => {
  await create(page, 'Avoid accidental deletion')
  await page.getByRole('button', { name: 'Back to Docs', exact: true }).click()
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click()
  await page.getByRole('button', { name: /Trash \(1\)/ }).click()
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await page.getByRole('button', { name: 'Delete forever', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete permanently?' })
  await expect(confirm).toBeVisible()
  expect(await records(page)).toHaveLength(1)
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await records(page)).toHaveLength(1)
  await page.getByRole('button', { name: 'Delete forever', exact: true }).click()
  await confirm.getByRole('button', { name: 'Delete permanently', exact: true }).click()
  await expect.poll(async () => (await records(page)).length).toBe(0)
})

test('keyboard creation and a substantial Unicode paste work in a short narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 })
  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog').getByLabel('Name', { exact: true })).toBeFocused()
  await page.keyboard.type('Keyboard document')
  await page.keyboard.press('Enter')
  const editor = page.getByRole('textbox', { name: 'Document content' })
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  const text = 'Offline work العربية हिन्दी 🙂 '.repeat(300)
  await editor.fill(text)
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  expect(JSON.stringify((await records(page))[0].content)).toContain(text.trim())
  await page.getByRole('button', { name: 'Offline help' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Got it', exact: true })).toBeInViewport()
})

test('folder and list menus remain clickable without clipping or hover', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await create(page, 'List actions')
  await page.getByRole('button', { name: 'Back to Docs', exact: true }).click()
  await page.getByRole('button', { name: 'List view', exact: true }).click()
  await page.getByRole('button', { name: 'File actions', exact: true }).click()
  await page.getByRole('button', { name: 'Star', exact: true }).click()
  await expect.poll(async () => (await records(page))[0].starred).toBe(true)
  await page.getByRole('button', { name: 'New folder', exact: true }).click()
  const newFolder = page.getByRole('dialog', { name: 'Create a folder', exact: true })
  await expect(newFolder).toBeVisible()
  await newFolder.getByLabel('Folder name', { exact: true }).fill('My local folder')
  await newFolder.getByRole('button', { name: 'Create folder', exact: true }).click()
  await expect(newFolder).toHaveCount(0)
  await expect.poll(async () => (await records(page, 'folders'))[0].name).toBe('My local folder')
  await page.getByRole('button', { name: 'Folder actions', exact: true }).click()
  await page.getByRole('button', { name: 'Move to trash', exact: true }).click()
  await expect.poll(async () => (await records(page, 'folders'))[0].trashed).toBe(true)
  await page.getByRole('button', { name: /Trash \(1\)/ }).click()
  await page.getByRole('button', { name: 'Folder actions', exact: true }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect.poll(async () => (await records(page, 'folders'))[0].trashed).toBe(false)
})
