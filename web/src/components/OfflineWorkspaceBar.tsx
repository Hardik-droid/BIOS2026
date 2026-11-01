import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { deviceMetadata, exportLocalWorkspace, importLocalWorkspace, MAX_BACKUP_BYTES, parseWorkspaceBackup } from '../lib/offline/workspace'
import { downloadJson } from '../lib/offline/download'
import { onUpdateAvailable } from '../lib/endpoints/offlineBootstrap'
import { useFilesStore } from '../store/filesStore'
import { Button, Modal } from './ui'
import NearbyBluetooth from './NearbyBluetooth'

const message = (reason: unknown) => reason instanceof Error ? reason.message : 'The operation could not finish. Please try again.'

export default function OfflineWorkspaceBar() {
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const [help, setHelp] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [pending, setPending] = useState<{ json: string; name: string; files: number; folders: number; trashed: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    const unsubscribe = onUpdateAvailable(() => setUpdateReady(true))
    return () => { unsubscribe() }
  }, [])
  const inspect = useCallback(async () => {
    setChecking(true)
    setError('')
    try { await deviceMetadata(); if (mounted.current) setReady(true) }
    catch (reason) { if (mounted.current) { setReady(false); setError(message(reason)) } }
    finally { if (mounted.current) setChecking(false) }
    try {
      const [kept, estimate] = await Promise.all([navigator.storage?.persisted?.(), navigator.storage?.estimate?.()])
      if (!mounted.current) return
      if (typeof kept === 'boolean') setPersistent(kept)
      if (estimate?.quota) setStorage({ usage: estimate.usage || 0, quota: estimate.quota })
    } catch { /* Estimates are optional, not evidence that document storage failed. */ }
  }, [])
  useEffect(() => {
    mounted.current = true
    void inspect()
    const onFocus = () => { void inspect() }
    window.addEventListener('focus', onFocus)
    return () => { mounted.current = false; window.removeEventListener('focus', onFocus) }
  }, [inspect])
  const keepData = async () => {
    setError(''); setNotice('')
    if (!navigator.storage?.persist) { setNotice('This browser cannot protect local storage. Export a backup to keep a separate copy.'); return }
    setBusy(true)
    try {
      const allowed = await navigator.storage.persist()
      setPersistent(allowed)
      setNotice(allowed ? 'Storage protection allowed. Keep a backup too; clearing browser data still deletes documents.' : 'The browser did not allow storage protection. Your files are still local; export a backup to keep a separate copy.')
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  const backup = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      downloadJson(await exportLocalWorkspace(), `diwan-workspace-${new Date().toISOString().slice(0, 10)}.json`)
      setNotice('Backup download started. It contains saved files and history, including Trash. Keep the downloaded file somewhere safe.')
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  const chooseBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(''); setNotice(''); setPending(null); setBusy(true)
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('This backup is larger than the 32 MiB restore limit. Choose a smaller Diwan backup.')
      const json = await file.text()
      const parsed = parseWorkspaceBackup(json)
      if (!parsed.files.length && !parsed.folders.length) throw new Error('This backup is empty. Your existing files have not changed.')
      setPending({ json, name: file.name, files: parsed.files.length, folders: parsed.folders.length, trashed: parsed.files.filter(entry => entry.trashed).length })
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  const restore = async () => {
    if (!pending || busy) return
    setBusy(true); setError('')
    try {
      const result = await importLocalWorkspace(pending.json)
      await useFilesStore.getState().fetchFiles()
      await useFilesStore.getState().fetchFolders()
      setPending(null)
      setNotice(`Restored ${result.files} file(s) and ${result.folders} folder(s) as new copies. Existing files were kept. Files marked as deleted are in Trash.`)
    } catch (reason) { setError(message(reason)) }
    finally { setBusy(false) }
  }
  const lowStorage = !!storage && storage.usage / storage.quota >= 0.9
  return <>
    <section className="flex-shrink-0 border-b border-line bg-paper px-3 py-2 text-xs text-ink-muted" aria-label="Local workspace status">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>{ready ? 'Local workspace · Internet access disabled' : checking ? 'Opening local storage…' : 'Local storage unavailable'}</span>
        <NearbyBluetooth />
        {ready && <button className="underline min-h-8" disabled={busy} onClick={() => void backup()}>Export workspace</button>}
        {ready && <button className="underline min-h-8" disabled={busy} onClick={() => input.current?.click()}>Restore backup</button>}
        {ready && persistent !== true && <button className="underline min-h-8" disabled={busy} onClick={() => void keepData()}>Keep data on this device</button>}
        {persistent === true && <span>Storage protection allowed</span>}
        <button className="underline min-h-8" onClick={() => setHelp(true)}>Offline help</button>
        {!ready && !checking && <button className="underline min-h-8" onClick={() => void inspect()}>Retry storage</button>}
      </div>
      <input ref={input} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-label="Choose workspace backup" onChange={event => void chooseBackup(event)} />
      {notice && <p role="status" className="mt-1 break-words">{notice}</p>}
      {error && <p role="alert" className="mt-1 break-words text-danger">{error}</p>}
      {lowStorage && <p role="status" className="mt-1 text-warning">Local storage is nearly full. Export a backup before removing files or clearing browser data.</p>}
      {updateReady && <p role="status" className="mt-1">An app update is ready. Save your work, close all Diwan tabs and windows, then reopen the offline launcher.</p>}
    </section>
    <Modal open={!!pending} title="Restore workspace backup" onClose={() => { if (!busy) setPending(null) }}>
      <Modal.Body className="space-y-3 text-sm">
        <p className="break-all">{pending?.name}</p>
        <p>{pending?.files} file(s), {pending?.folders} folder(s), including {pending?.trashed} file(s) in Trash.</p>
        <p>Restore adds new copies. Your current files and unsaved editor stay in place. Repeating a restore creates another set of copies.</p>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </Modal.Body>
      <Modal.Footer>
        <Button disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={() => void restore()}>{busy ? 'Restoring…' : 'Restore as new copies'}</Button>
      </Modal.Footer>
    </Modal>
    <Modal open={help} title="Using Diwan offline" onClose={() => setHelp(false)} size="lg">
      <Modal.Body className="space-y-4 text-sm leading-relaxed">
        <p>Create a document, type, and wait for “Saved on this device.” You can also press Ctrl+S or choose Save. Saving does not need internet.</p>
        <p>Files live in this browser profile on this device. Use the same browser and the offline launcher. Private browsing, changing profiles, or clearing site data can remove access to your files. Anyone using this unlocked profile can read them.</p>
        <p>Choose Export workspace to download saved files and history. Save your current edits first. Copy the backup to a USB drive or another safe location. Restore backup adds new copies without replacing existing work; it accepts Diwan JSON backups up to 32 MiB.</p>
        <p>If Save fails, keep the document open and download a recovery copy from the error message. Free storage if needed, then choose Save again. A recovered draft must be restored or discarded before editing.</p>
        <p>Bluetooth sharing between Windows laptops needs this package on both computers and pairing in Windows Settings. Open a document, choose Bluetooth sharing, and share it. Enter its invitation on the other laptop. Android, comments and suggestions are not available in this build.</p>
        <p>After an app update, save your work, close all Diwan tabs and windows, then reopen the offline launcher. Saved files stay in the same browser profile.</p>
        {storage && <p>Browser storage estimate: {(storage.usage / 1048576).toFixed(1)} MiB used of {(storage.quota / 1048576).toFixed(0)} MiB available to this site. This is an estimate, not your device's free disk space.</p>}
      </Modal.Body>
      <Modal.Footer><Button variant="primary" onClick={() => setHelp(false)}>Got it</Button></Modal.Footer>
    </Modal>
  </>
}
