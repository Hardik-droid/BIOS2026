import { LEGACY } from '../brandCompatibility'
export const MAX_INVITATION_FILE_BYTES = 4096

const sourceInstructions = 'On the hosting laptop, open the document, choose Bluetooth → Share this document → Save invitation file. It is saved in Downloads as localfirst-bluetooth-invitation.json.'

/** A short code is a direct, paired-device bootstrap, never a TLS identity. */
export function normalizeBluetoothPairingCode(value: string): string {
  const code = value.trim()
  if (!/^[0-9]{4}$/.test(code)) throw new Error('Enter exactly four digits, including any leading zeros, or use the full Bluetooth invitation.')
  return code
}

/** Validate the complete opaque code; never search arbitrary files for secrets. */
export function normalizeBluetoothInvitation(value: string): string {
  if (new TextEncoder().encode(value).byteLength > MAX_INVITATION_FILE_BYTES) throw new Error('The invitation is too large. ' + sourceInstructions)
  const code = value.trim().replace(/[ \t\r\n]/g, '')
  if (/^DBT\d+-/.test(code) && !code.startsWith('DBT1-')) throw new Error('This invitation uses a different Bluetooth version. Run the same updated offline package on both laptops and save a fresh invitation.')
  if (!/^DBT1-[a-zA-Z0-9_-]{86}$/.test(code)) throw new Error('The invitation code is incomplete or invalid. Paste the entire DBT1- code, or load the invitation file. ' + sourceInstructions)
  return code
}

/** Accept a short direct-pairing code, or the existing full invitation formats. */
export function parseBluetoothInvitation(text: string): string {
  if (new TextEncoder().encode(text).byteLength > MAX_INVITATION_FILE_BYTES) throw new Error('Choose the small Bluetooth invitation file, not a document or workspace backup. ' + sourceInstructions)
  const content = text.trim()
  if (!content) throw new Error('The invitation file is empty. ' + sourceInstructions)
  if (/^[0-9]+$/.test(content)) return normalizeBluetoothPairingCode(content)
  if (/^DBT/.test(content)) return normalizeBluetoothInvitation(content)
  let data: unknown
  try { data = JSON.parse(content) } catch { throw new Error('The invitation file could not be read. Use the original downloaded JSON file or a complete DBT1- text code. ' + sourceInstructions) }
  if (typeof data === 'string') return normalizeBluetoothInvitation(data)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This is not a Bluetooth invitation. ' + sourceInstructions)
  const entry = data as Record<string, unknown>
  if ((entry.format === LEGACY.backupFormat || entry.format === 'localfirst-local-workspace')) throw new Error('This is a workspace backup, not a Bluetooth invitation. Keep it for restoring documents. ' + sourceInstructions)
  if ((entry.format === LEGACY.connectionFormat || entry.format === 'localfirst-bluetooth-connection-report')) throw new Error('This is a connection report, not a Bluetooth invitation. ' + sourceInstructions)
  if (entry.format !== LEGACY.invitationFormat && entry.format !== 'localfirst-bluetooth-invitation') throw new Error('This is not a LocalFirst Bluetooth invitation file. ' + sourceInstructions)
  if (entry.version !== 1) throw new Error('This invitation file uses an unsupported version. Run the same updated offline package on both laptops and save a fresh invitation.')
  if (typeof entry.invitation !== 'string') throw new Error('The invitation file has no invitation code. ' + sourceInstructions)
  return normalizeBluetoothInvitation(entry.invitation)
}

export function createBluetoothInvitationFile(invitation: string): string {
  return JSON.stringify({ format: 'localfirst-bluetooth-invitation', version: 1, invitation: normalizeBluetoothInvitation(invitation) }, null, 2)
}

export async function readBluetoothInvitationFile(file: Pick<File, 'size' | 'text'>): Promise<string> {
  if (file.size > MAX_INVITATION_FILE_BYTES) throw new Error('Choose the small Bluetooth invitation file, not a document or workspace backup. ' + sourceInstructions)
  let text: string
  try { text = await file.text() } catch { throw new Error('Windows could not open this invitation file. Copy it to this laptop, then choose Load invitation file again.') }
  return parseBluetoothInvitation(text)
}
