import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test('the host can find a document from Home and generate its invitation (native transport stub)', async ({ page }) => {
  const invitation = 'DBT1-' + 'B'.repeat(86)
  let status: Record<string, unknown> = { state: 'idle' }
  let hostedId = ''
  await page.route('**/_nearby/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/').pop()
    let body: unknown = {}
    if (path === 'bootstrap') body = { token: 'test-token', transport: 'windows-bluetooth-rfcomm', version: 1 }
    else if (path === 'status') body = { status, radio: { available: true, name: 'Test radio' } }
    else if (path === 'devices') body = []
    else if (path === 'events') { await new Promise(resolve => setTimeout(resolve, 100)); body = { status, cursor: 0, events: [], reset: false } }
    else if (path === 'host') {
      const command = route.request().postDataJSON() as { document: { id: string; name: string } }
      hostedId = command.document.id
      status = { state: 'listening', role: 'host', document: command.document, invitation, session: 'test-session' }
      body = status
    } else if (path === 'stop') { status = { state: 'idle' }; body = status }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {})
  })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Bluetooth sharing', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Connect two Windows laptops' })
  await expect(panel.getByText('Create a Docs document first, then return to Bluetooth sharing.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Open document to share', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: 'Close', exact: true }).last().click()

  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).first().click()
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Host invitation regression')
  await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Document content' })
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await editor.fill('Keep this text when creating an invitation.')
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible()
  const documentId = new URL(page.url()).pathname.split('/').pop()!

  await page.goto('/')
  await page.getByRole('button', { name: 'Bluetooth sharing', exact: true }).click()
  await panel.getByLabel('Document to share', { exact: true }).selectOption(documentId)
  await panel.getByRole('button', { name: 'Open document to share', exact: true }).click()
  await expect(editor).toHaveAttribute('contenteditable', 'true')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Save invitation file', exact: true })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Save invitation file', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: 'Share this document', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Save invitation file', exact: true })).toBeEnabled()
  expect(hostedId).toBe(documentId)
  const downloading = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Save invitation file', exact: true }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('diwan-bluetooth-invitation.json')
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual({ format: 'diwan-bluetooth-invitation', version: 1, invitation })
  await panel.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Save invitation file', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(editor).toContainText('Keep this text when creating an invitation.')
  expect(errors).toEqual([])
})

test('a workspace backup is identified before connecting, and the exact saved invitation loads on the other laptop (native transport stub)', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Test server URL is required.')
  const invitation = 'DBT1-' + 'A'.repeat(86)
  const errors: string[] = []
  let connects = 0
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })])
  try {
    const pages = await Promise.all(contexts.map(async (context, index) => {
      let status: Record<string, unknown> = index === 0
        ? { state: 'listening', role: 'host', invitation, document: { id: '97a562f0-0751-4ee1-8634-78b80914077d', name: 'Invitation transfer check' } }
        : { state: 'idle' }
      await context.route('**/_nearby/**', async route => {
        const path = new URL(route.request().url()).pathname.split('/').pop()
        let body: unknown = {}
        if (path === 'bootstrap') body = { token: 'test-only-local-token', transport: 'windows-bluetooth-rfcomm', version: 1 }
        else if (path === 'status') body = { status, radio: { available: true, name: 'Test radio control stub' } }
        else if (path === 'devices') body = [{ address: '001122334455', name: 'Test hosting laptop' }]
        else if (path === 'events') { await new Promise(resolve => setTimeout(resolve, 100)); body = { status, cursor: 0, events: [], reset: false } }
        else if (path === 'connect') {
          const command = route.request().postDataJSON() as { invitation: string }
          expect(command.invitation).toBe(invitation)
          connects++
          status = { state: 'connected', role: 'join', document: { id: '97a562f0-0751-4ee1-8634-78b80914077d', name: 'Invitation transfer check' } }
          body = status
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {})
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/docs')
      await page.getByRole('button', { name: index === 0 ? 'Bluetooth waiting' : 'Bluetooth sharing', exact: true }).click()
      return page
    }))
    const receiver = pages[1].getByRole('dialog', { name: 'Connect two Windows laptops' })
    await receiver.getByLabel('Paired laptop', { exact: true }).selectOption('001122334455')
    const input = receiver.getByLabel('Choose Bluetooth invitation file', { exact: true })
    await input.setInputFiles({ name: 'diwan-workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'diwan-local-workspace', version: 1, files: [] })) })
    await expect(receiver.getByRole('alert')).toContainText('workspace backup')
    await expect(receiver.getByRole('alert')).toContainText('Save invitation file')
    await expect(receiver.getByRole('button', { name: 'Connect over Bluetooth', exact: true })).toBeDisabled()
    expect(connects).toBe(0)

    const downloaded = pages[0].waitForEvent('download')
    await pages[0].getByRole('button', { name: 'Save invitation file', exact: true }).click()
    const file = await downloaded
    expect(file.suggestedFilename()).toBe('diwan-bluetooth-invitation.json')
    await input.setInputFiles((await file.path())!)
    await expect(receiver.getByLabel('Host invitation', { exact: true })).toHaveValue(invitation)
    await expect(receiver.getByRole('alert')).toHaveCount(0)

    // Rejecting a subsequent file must clear the previous code, so Connect
    // cannot silently use a stale invitation from an earlier selection.
    await input.setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') })
    await expect(receiver.getByRole('alert')).toContainText('could not be read')
    await expect(receiver.getByLabel('Host invitation', { exact: true })).toHaveValue('')
    await expect(receiver.getByRole('button', { name: 'Connect over Bluetooth', exact: true })).toBeDisabled()
    expect(connects).toBe(0)
    await input.setInputFiles((await file.path())!)
    await receiver.getByRole('button', { name: 'Connect over Bluetooth', exact: true }).click()
    await expect(receiver.getByText('Authenticated Bluetooth link connected.', { exact: true })).toBeVisible()
    expect(connects).toBe(1)
    expect(errors).toEqual([])
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
})
