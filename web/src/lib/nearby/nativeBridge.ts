import { create } from 'zustand'

export interface NearbyDocument { id: string; name: string }
export interface NearbyStatus { state: 'idle' | 'listening' | 'connecting' | 'connected' | 'error'; role?: 'host' | 'join'; document?: NearbyDocument; session?: string; invitation?: string; pairingCode?: string; pairingExpiresAt?: string; pairingRequest?: { id: string; address: string }; pairingError?: string; error?: string; sentBytes?: number; receivedBytes?: number; needsResync?: boolean }
export interface NearbyMessage { fileId: string; kind: 'vector' | 'update' | 'ack'; data: string; id?: string }
export interface NearbyWire {
  status: () => NearbyStatus
  send: (message: NearbyMessage) => Promise<void>
  onMessage: (listener: (message: NearbyMessage) => void) => () => void
  onStatus: (listener: (status: NearbyStatus) => void) => () => void
}
export const useNativeNearby = create<{ reachable: boolean; status: NearbyStatus; error: string; radio?: { available: boolean; name: string; error?: string } }>(() => ({ reachable: false, status: { state: 'idle' }, error: '' }))
const messages = new Set<(message: NearbyMessage) => void>()
let token = ''
let started = false
let refreshing: Promise<void> | null = null
let polling: AbortController | null = null

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/_nearby/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'X-Diwan-Native-Token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}), credentials: 'omit', mode: 'same-origin', redirect: 'error', cache: 'no-store' })
  const result: unknown = await response.json()
  if (!response.ok) throw new Error((result as { error?: string })?.error || 'The local Bluetooth bridge could not complete this action.')
  return result as T
}
async function poll(controller: AbortController) {
  let cursor = 0
  while (!controller.signal.aborted) {
    try {
      const batch = await request<{ status: NearbyStatus; cursor: number; reset: boolean; events: Array<{ session: string; message?: NearbyMessage }> }>(`events?after=${cursor}`, undefined, controller.signal)
      if (controller.signal.aborted) return
      cursor = batch.cursor
      // Notify a dropped-event reset before dispatch, so queued messages belong
      // to the resynchronizing generation rather than an obsolete one.
      useNativeNearby.setState({ status: batch.reset ? { ...batch.status, needsResync: true } : batch.status })
      for (const event of batch.events) if (event.message && event.session === batch.status.session) for (const listener of messages) listener(event.message)
    } catch (reason) {
      if (controller.signal.aborted) return
      started = false
      useNativeNearby.setState({ reachable: false, status: { state: 'error', error: 'The local Bluetooth helper stopped. Reopen the Windows launcher.' }, error: reason instanceof Error ? reason.message : 'Bluetooth helper is unavailable.' })
      return
    }
  }
}
export function startNativeBridge(force = false): Promise<void> {
  if (refreshing) return refreshing
  if (started && !force) return Promise.resolve()
  started = true
  refreshing = (async () => {
    polling?.abort()
    try {
      const bootstrap = await request<{ token: string; transport: string; version: number }>('bootstrap')
      if (bootstrap.transport !== 'windows-bluetooth-rfcomm' || bootstrap.version !== 1 || typeof bootstrap.token !== 'string') throw new Error('This launcher does not include the Windows Bluetooth bridge.')
      token = bootstrap.token
      const result = await request<{ status: NearbyStatus; radio: { available: boolean; name: string; error?: string } }>('status')
      useNativeNearby.setState({ reachable: true, status: result.status, radio: result.radio, error: '' })
      polling = new AbortController()
      void poll(polling)
    } catch {
      started = false
      useNativeNearby.setState({ reachable: false, status: { state: 'error', error: 'Bluetooth sharing needs the Windows offline launcher.' }, error: 'Bluetooth sharing needs the Windows offline launcher. Local editing still works.' })
    }
  })().finally(() => { refreshing = null })
  return refreshing
}
export async function bluetoothCommand(command: 'host' | 'connect' | 'stop' | 'approve-pairing' | 'reject-pairing', body: unknown = {}): Promise<void> {
  try {
    const status = await request<NearbyStatus>(command, body)
    useNativeNearby.setState({ status, error: '' })
  } catch (reason) {
    useNativeNearby.setState({ error: reason instanceof Error ? reason.message : 'Bluetooth action failed.' })
    throw reason
  }
}
export async function pairedBluetoothDevices(): Promise<Array<{ address: string; name: string }>> { return request('devices') }
export const nativeWire: NearbyWire = {
  status: () => useNativeNearby.getState().status,
  send: async message => { await request('send', { message }) },
  onMessage: listener => { messages.add(listener); return () => { messages.delete(listener) } },
  onStatus: listener => useNativeNearby.subscribe(state => listener(state.status)),
}
