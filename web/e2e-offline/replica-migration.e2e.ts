import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('opting into a local replica preserves existing text, later edits and a fully offline restart (native controls stubbed)', async ({ page, context }) => {
  let status: Record<string, unknown> = { state: 'idle' }
  let cursor = 0
  // This test verifies editor migration/persistence. It does not claim a radio connection.
  await page.route('**/_nearby/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = {}
    if (path.endsWith('/bootstrap')) body = { token: 'test-token', transport: 'windows-bluetooth-rfcomm', version: 1 }
    else if (path.endsWith('/status')) body = { status, radio: { available: true, name: 'Test radio control stub' } }
    else if (path.endsWith('/devices')) body = []
    else if (path.endsWith('/host')) { const command = route.request().postDataJSON() as { document: unknown }; status = { state: 'listening', role: 'host', document: command.document, session: 'test-session' }; body = status }
    else if (path.endsWith('/events')) { await new Promise(resolve => setTimeout(resolve, 150)); body = { status, cursor: ++cursor, events: [], reset: false } }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {})
  })
  page.on('dialog', dialog => void dialog.accept())
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).first().click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Existing work before Bluetooth')
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Document content' })
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await editor.fill('Existing important content must survive migration.')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Bluetooth', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Connect two Windows laptops' })
  await panel.getByRole('button', { name: 'Share this document', exact: true }).click()
  await expect(panel.getByText('Waiting for the other laptop…', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await expect(editor).toContainText('Existing important content must survive migration.')
  await editor.click()
  await page.keyboard.press('Control+End')
  // Native selection updates can land after the key event under load. Verify
  // the intended insertion point before checking exact persisted text below.
  await expect.poll(() => editor.evaluate(element => {
    const instance = (element as HTMLElement & { editor: import('@tiptap/react').Editor }).editor
    return instance.state.selection.empty && instance.state.selection.from === instance.state.doc.content.size - 1
  })).toBe(true)
  await page.keyboard.type(' More durable text after migration.')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await expect(editor).toContainText('Existing important content must survive migration.')
  await expect(editor).toContainText('More durable text after migration.')
  await page.getByRole('textbox', { name: 'Document title' }).fill('Renamed shared replica')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('Renamed shared replica')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Version history', exact: true }).click()
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click()
  await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('Existing work before Bluetooth')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  await page.reload()
  await expect(editor).toContainText('Existing important content must survive migration.')
  await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('Existing work before Bluetooth')
  await page.addInitScript(() => {
    const original = indexedDB.open.bind(indexedDB)
    indexedDB.open = ((...args: Parameters<IDBFactory['open']>) => {
      if (args[0] === 'diwan-replicas') throw new DOMException('Replica storage is blocked', 'SecurityError')
      return original(...args)
    }) as IDBFactory['open']
  })
  await page.reload()
  const recoveryAlert = page.getByRole('alert').filter({ hasText: 'Local replica storage needs attention.' })
  await expect(recoveryAlert).toBeVisible()
  await expect(editor).toHaveAttribute('contenteditable', 'false')
  const recoveryEvent = page.waitForEvent('download')
  await recoveryAlert.getByRole('button', { name: 'Download recovery copy', exact: true }).click()
  const recovered = JSON.parse(await readFile((await (await recoveryEvent).path())!, 'utf8')) as { files: Array<{ content: unknown }> }
  expect(JSON.stringify(recovered.files[0].content)).toContain('Existing important content must survive migration.')
  expect(failures).toEqual([])
})
