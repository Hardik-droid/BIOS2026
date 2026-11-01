import { test, expect, type BrowserContext, type Page } from '@playwright/test'

interface Peer {
  status: Record<string, unknown>
  seq: number
  events: Array<{ seq: number; session: string; message?: unknown }>
}
const invitation = 'DBT1-' + 'a'.repeat(86)

test('two real editor copies preserve formatting and merge edits across disconnection and reload (transport stub only)', async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error('Test server URL is required.')
  const origin = baseURL
  const a: Peer = { status: { state: 'idle' }, seq: 0, events: [] }
  const b: Peer = { status: { state: 'idle' }, seq: 0, events: [] }
  const contexts: BrowserContext[] = []
  const errors: string[] = []
  const external: string[] = []
  const signal = (peer: Peer, message?: unknown) => { peer.events.push({ seq: ++peer.seq, session: String(peer.status.session || ''), ...(message ? { message } : {}) }) }
  async function setup(peer: Peer, other: Peer): Promise<Page> {
    const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'allow' })
    contexts.push(context)
    context.on('request', request => {
      const url = new URL(request.url())
      if (url.origin !== origin || /^\/(api|v1)(\/|$)/.test(url.pathname)) external.push(request.url())
    })
    // A test-only local-control stub carries opaque messages between isolated
    // browser profiles. This is editor/protocol evidence, not RFCOMM proof.
    await context.route('**/_nearby/**', async route => {
      const url = new URL(route.request().url())
      const path = url.pathname.split('/').pop()
      let result: unknown = {}
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() as Record<string, unknown> : {}
      if (path === 'bootstrap') result = { token: 'isolated-test-control', transport: 'windows-bluetooth-rfcomm', version: 1 }
      else if (path === 'status') result = { status: peer.status, radio: { available: true, name: 'Test control stub' } }
      else if (path === 'devices') result = [{ address: '001122334455', name: 'Test hosting laptop' }]
      else if (path === 'host') {
        peer.status = { state: 'listening', role: 'host', session: 'editor-protocol-test-session', document: body.document, invitation }
        signal(peer); result = peer.status
      } else if (path === 'connect') {
        if (body.invitation !== invitation || !other.status.document) { await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Invalid test invitation"}' }); return }
        other.status = { ...other.status, state: 'connected' }
        peer.status = { state: 'connected', role: 'join', session: other.status.session, document: other.status.document }
        signal(other); signal(peer); result = peer.status
      } else if (path === 'stop') {
        peer.status = { state: 'idle' }
        other.status = { ...other.status, state: 'listening' }
        signal(peer); signal(other); result = peer.status
      } else if (path === 'send') {
        if (peer.status.state !== 'connected' || other.status.state !== 'connected') { await route.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"Test link disconnected"}' }); return }
        signal(other, body.message)
        result = peer.status
      } else if (path === 'events') {
        if (Number(url.searchParams.get('after')) >= peer.seq) await new Promise(resolve => setTimeout(resolve, 80))
        result = { status: peer.status, cursor: peer.seq, events: peer.events.filter(event => event.seq > Number(url.searchParams.get('after'))), reset: false }
      }
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) }).catch(() => {})
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => void dialog.accept())
    return page
  }
  async function append(page: Page, text: string) {
    await page.getByRole('textbox', { name: 'Document content' }).click()
    await page.keyboard.press('Control+End')
    await page.keyboard.insertText(text)
  }
  async function connect(page: Page) {
    await page.getByRole('button', { name: 'Bluetooth sharing', exact: true }).click()
    const panel = page.getByRole('dialog', { name: 'Connect two Windows laptops' })
    await panel.getByLabel('Paired laptop', { exact: true }).selectOption('001122334455')
    await panel.getByLabel('Host invitation', { exact: true }).fill(invitation)
    await panel.getByRole('button', { name: 'Connect over Bluetooth', exact: true }).click()
    await panel.getByRole('button', { name: 'Open shared document', exact: true }).click()
    await expect(panel).toHaveCount(0)
  }
  try {
    const pa = await setup(a, b), pb = await setup(b, a)
    await pa.goto('/docs')
    await pa.getByRole('button', { name: 'New Document', exact: true }).first().click()
    await pa.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Shared editor protocol check')
    await pa.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click()
    const ea = pa.getByRole('textbox', { name: 'Document content' })
    await expect(ea).toHaveAttribute('contenteditable', 'true')
    await ea.fill('Original document ')
    await pa.keyboard.press('Control+End'); await pa.keyboard.press('Control+b'); await pa.keyboard.insertText('formatted text'); await pa.keyboard.press('Control+b')
    await pa.keyboard.press('Control+s')
    await expect(pa.getByText('Saved on this device', { exact: true })).toBeVisible()
    await pa.getByRole('button', { name: 'Bluetooth', exact: true }).click()
    const hostPanel = pa.getByRole('dialog', { name: 'Connect two Windows laptops' })
    await hostPanel.getByRole('button', { name: 'Share this document', exact: true }).click()
    await expect(hostPanel.getByText('Waiting for the other laptop…', { exact: true })).toBeVisible()
    await hostPanel.getByRole('button', { name: 'Close', exact: true }).last().click()
    await pb.goto('/docs')
    await connect(pb)
    const eb = pb.getByRole('textbox', { name: 'Document content' })
    await expect(eb).toHaveAttribute('contenteditable', 'true')
    await expect(eb.locator('strong')).toHaveText('formatted text')
    await Promise.all([append(pa, ' FIRST-CONCURRENT-EDIT'), append(pb, ' SECOND-CONCURRENT-EDIT')])
    await expect(ea).toContainText('SECOND-CONCURRENT-EDIT')
    await expect(eb).toContainText('FIRST-CONCURRENT-EDIT')
    await expect.poll(async () => (await ea.innerText()) === (await eb.innerText())).toBe(true)
    await expect(pa.getByText('Other laptop acknowledged this version', { exact: true })).toBeVisible()
    await expect(pb.getByText('Other laptop acknowledged this version', { exact: true })).toBeVisible()
    await pb.getByRole('button', { name: 'Bluetooth connected', exact: true }).click()
    const clientPanel = pb.getByRole('dialog', { name: 'Connect two Windows laptops' })
    await clientPanel.getByRole('button', { name: 'Disconnect', exact: true }).click()
    await clientPanel.getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(clientPanel).toHaveCount(0)
    await Promise.all([append(pa, ' FIRST-OFFLINE-EDIT'), append(pb, ' SECOND-OFFLINE-EDIT')])
    await expect(pa.getByText('Saved on this device', { exact: true })).toBeVisible()
    await expect(pb.getByText('Saved on this device', { exact: true })).toBeVisible()
    await Promise.all([pa.reload(), pb.reload()])
    await expect(ea).toContainText('FIRST-OFFLINE-EDIT')
    await expect(eb).toContainText('SECOND-OFFLINE-EDIT')
    await connect(pb)
    await expect(ea).toContainText('SECOND-OFFLINE-EDIT')
    await expect(eb).toContainText('FIRST-OFFLINE-EDIT')
    await expect.poll(async () => (await ea.innerText()) === (await eb.innerText())).toBe(true)
    // Typing at the end of the bold run correctly inherits its formatting.
    await expect(ea.locator('strong')).toContainText('formatted text')
    await expect(eb.locator('strong')).toContainText('formatted text')
    await expect.poll(async () => (await ea.innerHTML()) === (await eb.innerHTML())).toBe(true)
    await expect(pa.getByText('Other laptop acknowledged this version', { exact: true })).toBeVisible()
    await expect(pb.getByText('Other laptop acknowledged this version', { exact: true })).toBeVisible()
    expect(errors).toEqual([]); expect(external).toEqual([])
  } finally { for (const context of contexts) await context.close() }
})
