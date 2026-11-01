import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { acceptLocalReplica } from '../lib/offline/workspace'
import { bluetoothCommand, pairedBluetoothDevices, startNativeBridge, useNativeNearby, type NearbyDocument } from '../lib/nearby/nativeBridge'
import { useFilesStore } from '../store/filesStore'
import { Button, Modal } from './ui'
import { downloadJson } from '../lib/offline/download'
import type { SyncState } from '../lib/nearby/documentSync'
import { createBluetoothInvitationFile, MAX_INVITATION_FILE_BYTES, parseBluetoothInvitation, readBluetoothInvitationFile } from '../lib/nearby/invitation'

export default function NearbyBluetooth({ prepare, sync }: { prepare?: () => Promise<NearbyDocument>; sync?: SyncState }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [devices, setDevices] = useState<Array<{ address: string; name: string }>>([])
  const [address, setAddress] = useState('')
  const [invitation, setInvitation] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [invitationNotice, setInvitationNotice] = useState('')
  const [documentId, setDocumentId] = useState('')
  const files = useFilesStore(state => state.files)
  const loadError = useFilesStore(state => state.loadError)
  const documents = files.filter(file => file.type === 'doc' && !file.trashed)
  const invitationFile = useRef<HTMLInputElement>(null)
  const { reachable, status, radio, error: bridgeError } = useNativeNearby()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const shareRequested = !!prepare && searchParams.get('bluetooth') === 'share'
  const closeDialog = () => {
    setOpen(false)
    if (shareRequested) {
      const next = new URLSearchParams(searchParams)
      next.delete('bluetooth')
      setSearchParams(next, { replace: true })
    }
  }
  let validatedInvitation = ''
  let invitationProblem = ''
  if (invitation.trim()) {
    try { validatedInvitation = parseBluetoothInvitation(invitation) }
    catch (reason) { invitationProblem = reason instanceof Error ? reason.message : 'The invitation could not be read.' }
  }
  const hostInvitationActive = status.role === 'host' && !!status.invitation && (status.state === 'listening' || status.state === 'connected')
  useEffect(() => { void startNativeBridge() }, [])
  const action = async (work: () => void | Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    try { await work() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Bluetooth action failed.') }
    finally { setBusy(false) }
  }
  const refresh = () => action(async () => {
    await startNativeBridge(true)
    if (!useNativeNearby.getState().reachable) return
    setDevices(await pairedBluetoothDevices())
  })
  const openDocument = () => action(async () => {
    if (!status.document) return
    const file = await acceptLocalReplica(status.document.id, status.document.name)
    useFilesStore.setState(state => ({ files: [file, ...state.files.filter(entry => entry.id !== file.id)] }))
    setOpen(false)
    void navigate(`/docs/${file.id}`)
  })
  const label = prepare ? 'Bluetooth' : status.state === 'connected' ? 'Bluetooth connected' : status.state === 'listening' ? 'Bluetooth waiting' : status.state === 'connecting' ? 'Bluetooth connecting…' : 'Bluetooth sharing'
  return <>
    <button className="underline min-h-8 text-xs" onClick={() => { setOpen(true); void refresh(); if (!prepare) void useFilesStore.getState().fetchFiles() }}>{label}</button>
    <Modal open={open || shareRequested} title="Connect two Windows laptops" size="lg" onClose={() => { if (!busy) closeDialog() }}>
      <Modal.Body className="space-y-4 text-sm">
        <p>Pair both laptops in Windows Bluetooth Settings first. Run this offline package on both. Wi-Fi and internet are not used for the link between laptops.</p>
        <p role="status">{reachable ? status.state === 'connected' ? 'Authenticated Bluetooth link connected.' : status.state === 'listening' ? 'Waiting for the other laptop…' : status.state === 'connecting' ? 'Connecting over Bluetooth…' : 'Bluetooth link is disconnected.' : 'Open this page using the Windows offline launcher.'}</p>
        {radio && <p>{radio.available ? `Local Bluetooth radio: ${radio.name}` : radio.error}</p>}
        {(error || bridgeError || status.error) && <p role="alert" className="text-danger break-words">{error || bridgeError || status.error}</p>}
        {!prepare && <section className="border border-line rounded-lg p-3 space-y-2">
          <p className="font-semibold">Create an invitation on this laptop</p>
          <p>Choose the document you want to share. In its Bluetooth dialog, choose Share this document, then Save invitation file.</p>
          <label className="block">Document to share<select aria-label="Document to share" className="block mt-1 w-full border border-line bg-paper p-2 rounded" value={documentId} onChange={event => setDocumentId(event.target.value)}>
            <option value="">Choose a document</option>
            {documents.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
          </select></label>
          {!documents.length && <p>Create a Docs document first, then return to Bluetooth sharing.</p>}
          {loadError && <p role="alert">The document list could not be loaded. Close this dialog and open the document from Docs.</p>}
          <Button disabled={busy || !documents.some(file => file.id === documentId)} onClick={() => {
            setOpen(false)
            void navigate(`/docs/${encodeURIComponent(documentId)}?bluetooth=share`)
          }}>Open document to share</Button>
        </section>}
        {prepare && <section className="border border-line rounded-lg p-3 space-y-2">
          <p className="font-semibold">On the laptop with the document</p>
          <p>Save and share this document. One document and one peer can be connected at a time. Both copies keep edits locally; reconnecting merges missing edits.</p>
          <Button disabled={busy || !reachable || !radio?.available} onClick={() => void action(async () => { const document = await prepare(); await bluetoothCommand('host', { document }); setCopied(false) })}>Share this document</Button>
        </section>}
        {(prepare || (status.role === 'host' && status.invitation)) && <section className="space-y-2">
          <label className="block font-semibold" htmlFor="bluetooth-invitation">Invitation for the other laptop</label>
          <textarea id="bluetooth-invitation" className="w-full p-2 rounded border border-line bg-paper font-mono text-xs" rows={3} value={status.role === 'host' ? status.invitation || '' : ''} placeholder="Choose Share this document to generate an invitation." readOnly />
          <Button disabled={busy || !hostInvitationActive} onClick={() => void action(async () => { await navigator.clipboard.writeText(status.invitation!); setCopied(true) })}>{copied ? 'Copied invitation' : 'Copy invitation'}</Button>
          <Button className="ml-2" disabled={busy || !hostInvitationActive} onClick={() => void action(() => {
            downloadJson(createBluetoothInvitationFile(status.invitation!), 'diwan-bluetooth-invitation.json')
            setInvitationNotice('Invitation download started. Find diwan-bluetooth-invitation.json in Downloads, or press Ctrl+J in your browser. Transfer this file to the other laptop.')
          })}>Save invitation file</Button>
          <p>The invitation file is downloaded to this laptop’s Downloads folder. The browser may ask where to save it.</p>
          <p>Paste this code, or transfer its invitation file using Windows Bluetooth file sharing or USB. Anyone with this invitation and paired Bluetooth access can join. It expires after 30 minutes; delete the invitation file when finished.</p>
        </section>}
        {reachable && <section className="border border-line rounded-lg p-3 space-y-3">
          <p className="font-semibold">On the other laptop</p>
          <label className="block">Paired laptop<select aria-label="Paired laptop" className="block mt-1 w-full border border-line bg-paper p-2 rounded" value={address} onChange={event => setAddress(event.target.value)}>
            <option value="">Choose the hosting laptop</option>
            {devices.map(device => <option key={device.address} value={device.address}>{device.name || device.address}</option>)}
          </select></label>
          {!devices.length && <p>No paired devices found. Pair the laptops in Windows Settings, then choose Refresh Bluetooth.</p>}
          <p>Get the file from the hosting laptop: open its document → Bluetooth → Share this document → Save invitation file. Transfer <strong>diwan-bluetooth-invitation.json</strong> from its Downloads folder. A workspace backup cannot connect the laptops.</p>
          <label className="block">Host invitation<textarea aria-label="Host invitation" aria-invalid={!!invitationProblem} aria-describedby={invitationProblem ? 'bluetooth-invitation-problem' : undefined} className="block mt-1 w-full border border-line bg-paper p-2 rounded font-mono text-xs" rows={3} value={invitation} onChange={event => { setInvitation(event.target.value); setError(''); setInvitationNotice('') }} maxLength={MAX_INVITATION_FILE_BYTES} spellCheck={false} /></label>
          {invitationProblem && <p id="bluetooth-invitation-problem" role="alert" className="text-danger break-words">{invitationProblem}</p>}
          <input ref={invitationFile} type="file" accept=".json,.txt,application/json,text/plain" className="sr-only" tabIndex={-1} aria-label="Choose Bluetooth invitation file" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''
            if (file) void action(async () => {
              setInvitation(''); setInvitationNotice('')
              const code = await readBluetoothInvitationFile(file)
              setInvitation(code)
              setInvitationNotice('Invitation loaded. Select the hosting laptop, then choose Connect over Bluetooth.')
            })
          }} />
          <Button disabled={busy} onClick={() => invitationFile.current?.click()}>Load invitation file</Button>
          <Button disabled={busy || !radio?.available || !address || !validatedInvitation} onClick={() => void action(() => bluetoothCommand('connect', { address, invitation: validatedInvitation }))}>Connect over Bluetooth</Button>
        </section>}
        {invitationNotice && <p role="status">{invitationNotice}</p>}
        {status.state === 'connected' && status.document && <section className="space-y-2">
          <p className="break-words">Shared document: {status.document.name}</p>
          <Button variant="primary" disabled={busy} onClick={() => void openDocument()}>Open shared document</Button>
          <p>The editor reports when the other laptop has acknowledged the saved replica. A connected radio alone does not mean edits have synchronized.</p>
        </section>}
        {reachable && <details className="space-y-2">
          <summary className="cursor-pointer font-semibold">Connection details</summary>
          <p>Transport between laptops: Windows Bluetooth RFCOMM.</p>
          <p>Document payload: {status.sentBytes || 0} bytes sent, {status.receivedBytes || 0} bytes received.</p>
          {sync && <p>{sync.phase === 'acknowledged' ? 'The other laptop acknowledged the current saved replica.' : 'The current replica has not yet been acknowledged by the other laptop.'}</p>}
          <Button onClick={() => downloadJson(JSON.stringify({ format: 'diwan-bluetooth-connection-report', checkedAt: new Date().toISOString(), transport: 'windows-bluetooth-rfcomm', radioAvailable: radio?.available ?? null, state: status.state, role: status.role || '', fileId: status.document?.id || '', sentBytes: status.sentBytes || 0, receivedBytes: status.receivedBytes || 0, peerAcknowledgement: sync ? sync.phase : 'Open the shared document to inspect its acknowledgement', error: sync?.error || status.error || '' }, null, 2), 'diwan-bluetooth-connection-report.json')}>Save connection report</Button>
          <p>The report excludes the invitation and local bridge token.</p>
        </details>}
      </Modal.Body>
      <Modal.Footer>
        <Button disabled={busy} onClick={() => void refresh()}>Refresh Bluetooth</Button>
        {reachable && status.state !== 'idle' && <Button disabled={busy} onClick={() => void action(() => bluetoothCommand('stop'))}>Disconnect</Button>}
        <Button onClick={closeDialog} disabled={busy}>Close</Button>
      </Modal.Footer>
    </Modal>
  </>
}
