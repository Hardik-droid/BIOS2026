import { test, expect, chromium, type Page } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// These recovery tests deliberately reload documents with unsaved changes.
test.beforeEach(async ({ page }) => { page.on('dialog', dialog => void dialog.accept()) })

async function readRecord(page: Page, database: string, store: string, id: string): Promise<unknown> {
  return page.evaluate(({ database, store, id }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(database)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(store, 'readonly')
      const read = tx.objectStore(store).get(id)
      read.onsuccess = () => resolve(read.result as unknown)
      read.onerror = () => reject(read.error)
      tx.oncomplete = () => db.close()
    }
  }), { database, store, id })
}
async function newDoc(page: Page, name: string): Promise<string> {
  await page.goto('/docs')
  await expect(page.getByText('Local workspace · Internet access disabled')).toBeVisible()
  await page.getByRole('button', { name: 'New Document', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel(/Name/i).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page).toHaveURL(/\/docs\/[^/]+$/)
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true')
  return new URL(page.url()).pathname.split('/').pop()!
}
async function type(page: Page, marker: string): Promise<void> {
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(` ${marker}`)
}

test('offline creation, committed save, reload and export use no API or external network', async ({ page, context }) => {
  const network: string[] = []
  const errors: string[] = []
  context.on('request', request => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' || /^\/(api|v1)\//.test(url.pathname)) network.push(request.url())
  })
  page.on('pageerror', error => errors.push(error.message))
  const id = await newDoc(page, 'Real offline document')
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30000 }).toBe(true)
  await context.setOffline(true)
  await type(page, 'works without the internet')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.locator('.ProseMirror')).toContainText('works without the internet')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await type(page, 'and after a fully offline refresh')
  await expect.poll(async () => JSON.stringify(await readRecord(page, 'diwan-local-workspace', 'files', id))).toContain('and after a fully offline refresh')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export workspace', exact: true }).click()
  expect((await downloaded).suggestedFilename()).toMatch(/^localfirst-workspace-.*\.json$/)
  expect(network).toEqual([])
  expect(errors).toEqual([])
})

test('a pending recovery draft survives reload and is never replaced by a blank loading editor', async ({ page, context }) => {
  const id = await newDoc(page, 'Recovery check')
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    Object.assign(window, { blockWorkspaceWrites: true })
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'files' && Reflect.get(window, 'blockWorkspaceWrites')) throw new DOMException('Storage full', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })
  await type(page, 'this unsaved draft must survive')
  await expect.poll(async () => JSON.stringify(await readRecord(page, 'diwan-drafts', 'drafts', id))).toContain('this unsaved draft must survive')
  expect(JSON.stringify(await readRecord(page, 'diwan-local-workspace', 'files', id))).not.toContain('this unsaved draft must survive')
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30000 }).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Unsaved changes from a previous session were found.')).toBeVisible()
  await expect(page.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'false')
  expect(JSON.stringify(await readRecord(page, 'diwan-drafts', 'drafts', id))).toContain('this unsaved draft must survive')
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.locator('.ProseMirror')).toContainText('this unsaved draft must survive')
  await expect.poll(async () => JSON.stringify(await readRecord(page, 'diwan-local-workspace', 'files', id))).toContain('this unsaved draft must survive')
})

test('a stale tab cannot silently replace another tab\'s committed edit', async ({ page, context }) => {
  const id = await newDoc(page, 'Two local tabs')
  await type(page, 'common base')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  const other = await context.newPage()
  await other.goto(`/docs/${id}`)
  await expect(other.locator('.ProseMirror')).toHaveAttribute('contenteditable', 'true')
  await type(page, 'first tab committed')
  await expect.poll(async () => JSON.stringify(await readRecord(page, 'diwan-local-workspace', 'files', id))).toContain('first tab committed')
  await type(other, 'second tab unsaved')
  await expect.poll(async () => JSON.stringify(await readRecord(other, 'diwan-drafts', 'drafts', id))).toContain('second tab unsaved')
  expect(JSON.stringify(await readRecord(page, 'diwan-local-workspace', 'files', id))).toContain('first tab committed')
  expect(JSON.stringify(await readRecord(page, 'diwan-local-workspace', 'files', id))).not.toContain('second tab unsaved')
  await other.close()
})

test('the installed shell and document survive a complete browser restart without HTTP access', async ({ baseURL }) => {
  if (!baseURL) throw new Error('The offline test base URL is required.')
  const profile = await mkdtemp(join(tmpdir(), 'localfirst-offline-profile-'))
  let context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, serviceWorkers: 'allow', baseURL })
  let page = await context.newPage()
  const id = await newDoc(page, 'Browser restart')
  await type(page, 'durable across browser restart')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30000 }).toBe(true)
  await context.close()
  context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, serviceWorkers: 'allow', offline: true, baseURL })
  try {
    page = await context.newPage()
    await page.goto(`/docs/${id}`)
    await expect(page.locator('.ProseMirror')).toContainText('durable across browser restart')
    await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  } finally { await context.close() }
})
