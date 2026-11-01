# Share a document between two Windows laptops over Bluetooth

This is a Windows-only preview. Native classic Bluetooth RFCOMM, the local helper, durable Yjs replicas and the sharing UI are implemented. A real probe on the development laptop verified an active radio, paired-device enumeration, and RFCOMM listener creation with SDP service registration and removal. **An actual document exchange between two physical laptops has not yet been verified.** Use the acceptance checklist below to record that evidence before relying on the preview for important work.

Android and the full office feature set are outside this preview. Start with a small test Docs document and keep separate backups of important work.

Earlier verification on 1 November 2026 recorded **133 focused tests**, **18 Chrome scenarios**, **13 Go nearby tests**, and an actual packaged-owner flow that starts and stops the Bluetooth service on this laptop, preserves the document and reopens its journal with HTTP access disabled. These are historical results from before the four-digit pairing update. Invitation checks include the exact downloaded file moving between isolated browser profiles. The two-editor convergence test uses a transport stub; it does not satisfy the physical checklist. Machine-readable results are in the workspace parent's `Diwan-offline-package-verification.json` and `Diwan-Bluetooth-Hardware.json`.

## Prepare both laptops

1. Copy the **same complete Windows offline ZIP** to both laptops and extract it fully on each. Keep the executable, `web` folder and launcher files together. Do not run just a copied executable or run inside the ZIP. Node.js and Go are not required to use the package.
2. For an update, save your work, close **all** Diwan tabs and windows on that laptop, then open `Start-Diwan-Offline.cmd` from the newly extracted package. Repeat on the other laptop. Keep the same browser, browser profile and `http://127.0.0.1:8765` origin/port that held your documents. Do not clear browser data to update.
3. Turn on Bluetooth in Windows Settings on both laptops. Pair the laptops there and verify that the Windows pairing code matches on both laptops before accepting. Only keep an existing pairing if you trust the device and how it was paired; Diwan does not pair devices automatically. A four-digit Diwan code does not replace this Windows identity check.
4. Double-click `Start-Diwan-Offline.cmd` on each laptop. The browser should open `http://127.0.0.1:8765`. Use a regular browser profile, since its IndexedDB holds the documents and shared replicas. Files are not stored in the ZIP or beside the executable.
5. For the radio acceptance test, turn Wi-Fi off on both laptops and disconnect Ethernet or other internet links while leaving Bluetooth on. The local page still works. Keep the laptops near each other and awake.

The browser communicates with its own laptop's helper through `127.0.0.1:8765/_nearby/`. That loopback HTTP connection stays inside that laptop. The connection between laptops uses OS-authenticated and encrypted **classic Bluetooth RFCOMM**, with TLS 1.3 and an invitation that pins the hosting session's certificate and carries a random 256-bit secret. There is no inter-laptop IP/Wi-Fi transport or cloud fallback, and this path does not use BLE or Web Bluetooth.

The short pairing code is a convenience step for a **direct connection to a trusted, paired Windows laptop**. Windows first authenticates and encrypts the Bluetooth link; the host then approves the actual requesting device before the full invitation is passed across that link. Only after the existing pinned TLS authentication succeeds can document data flow. Four digits are not an encryption key or a replacement for the full invitation's cryptographic strength. Short-code pairing is disabled for experimental relay connections, whose next Bluetooth hop may be a relay phone rather than the document owner. See [Microsoft's Bluetooth socket security options](https://learn.microsoft.com/en-us/windows/win32/bluetooth/bluetooth-and-socket-options).

## On laptop A, which has the document

1. Open a Docs document and finish any recovery prompts. Use a small document for the first test. From Home, you can instead choose **Bluetooth sharing**, select **Document to share**, then **Open document to share**; this opens the document's Bluetooth dialog.
2. Choose **Bluetooth** in the document's top bar, then **Share this document**. This saves the current document and opts that document into the durable shared-replica journal. Wait for recovery/loading to finish if the editor reloads during this conversion. Ordinary documents remain in the existing local save flow until you explicitly share them.
3. Keep this document and dialog open. It should say **Waiting for the other laptop…** and display a **four-digit pairing code**, such as `0123`. Leading zeros are part of the code.
4. Tell the code to the person using laptop B, or choose **Copy pairing code**. B selects this paired laptop, enters the four digits and chooses **Connect over Bluetooth**. No invitation file is needed for this route.
5. A displays **Approve this laptop?** with the requesting laptop's actual Bluetooth address. Check that it is B, then choose **Allow this laptop**. Choose **Reject request** if the device is unexpected. B cannot access the document merely by entering the code; A must approve it first.

The four-digit code expires after **two minutes**, permits at most **three failed attempts** across the session and is consumed by a successful approval. The host has **30 seconds** to approve a pending request. Choose **Share this document** again to create a new host session and code if the old one expires or is locked. Starting a new session replaces any current peer connection, so save work first.

### Use the full invitation instead

Open **Invitation file and full code** in A's Bluetooth dialog. Choose **Copy invitation** to transfer the complete `DBT1-` code by a trusted method, or choose **Save invitation file** to download `diwan-bluetooth-invitation.json`.

Move that small invitation file to B using USB or Windows Bluetooth file transfer. For the latter, open Windows **Send or receive files via Bluetooth** (or run `fsquirt`): choose **Receive files** on B, then **Send files** on A, select B and send the downloaded JSON file. Accept/save it on B. Windows file transfer is only moving the invitation; Diwan subsequently uses its own Bluetooth session to carry document edits. The full-invitation route remains available for existing workflows and experimental relays; a relay does not support the four-digit shortcut.

Treat the invitation as a secret: someone who has it and paired Bluetooth access can join. The invitation/session expires after 30 minutes. Starting sharing again creates a fresh invitation; the other laptop must use that new code. Delete transferred invitation files when finished.

### Find the invitation file

The file exists only after choosing **Save invitation file** in the document's Bluetooth dialog on laptop A. Look in A's **Downloads** folder for **diwan-bluetooth-invitation.json**, or press **Ctrl+J** in that browser to find the download. The browser may ask you to choose another save location. Transfer this file to B before loading it there. **Export workspace** creates a document backup named `diwan-workspace-…json`; it does not create a Bluetooth invitation.

The updated importer identifies workspace backups and connection reports separately, explains how to create the right file, and clears any previously loaded code after a rejected file. It also accepts complete plain-text DBT1 codes and UTF-8 BOM/line wrapping. Truncated codes, unsupported versions and oversized files remain rejected. An expired host session cannot export its stale invitation. See [the invitation fix report](BLUETOOTH-INVITATION-FIX.md) for evidence and remaining physical validation.

## On laptop B

1. Choose **Bluetooth sharing** in the local workspace bar. Its label may show **Bluetooth waiting**, **Bluetooth connecting…** or **Bluetooth connected** when a session is active.
2. Choose **Refresh Bluetooth**. Under **Paired laptop**, choose laptop A, the host. Only Windows-authenticated paired devices are listed; select the laptop rather than a headset or another device.
3. Enter A's **four-digit pairing code** into **Host invitation**, including any leading zeros. Alternatively, paste the complete `DBT1-` invitation or choose **Load invitation file** and select the downloaded JSON file. Do not use a workspace backup or document export here.
4. Choose **Connect over Bluetooth**. For a four-digit code, ask A to check the requesting laptop and choose **Allow this laptop** within 30 seconds. Keep A's shared document and Bluetooth dialog open. If A rejects the request or approval/code expiry occurs, no shared document is opened. Retry with the still-active code, or choose **Share this document** on A for a fresh code if it is unavailable.
5. When the dialog reports **Authenticated Bluetooth link connected.** and names the shared document, choose **Open shared document**. Keep the editor open on both laptops. B may show **Waiting for the shared document over Bluetooth. Keep the hosting laptop connected.** until the initial replica arrives.
6. Make a short edit. Check both the local save status and the editor's Bluetooth status on the laptop that made the edit. **Other laptop acknowledged this version** means the other replica committed the update to its local journal before acknowledging it. A connected link by itself is not proof of synchronization.

For troubleshooting, open the editor's **Bluetooth → Connection details**. Sent/received values are actual document-protocol payload counters. **Save connection report** exports state and counters without the invitation or local bridge token. Record a report on each laptop if the physical test fails.

## Saving, reconnecting and limits

Both laptops keep their own shared replica in the browser profile. Local committed edits survive a Bluetooth disconnect. After reconnecting, the replicas exchange state vectors and missing updates to merge edits made on either laptop. During a disconnect the editor reports **Bluetooth link offline · local edits retained**; check that local saving has completed before closing or restarting.

After a radio interruption or restart, turn Bluetooth back on, reopen the same shared document on A, choose **Bluetooth → Share this document**, and transfer the fresh invitation to B. On B, refresh the paired-device list and connect as above, then choose **Open shared document**. Use the existing shared document on A to retain the same document identity. Do not create a new document or restore a backup as a new copy for this reconnect test. Keep both shared editors open while resynchronization completes.

- One document and one peer can be connected at a time. Starting another host/join session replaces the current session. **Disconnect** ends the link; the locally saved documents remain.
- The source document's JSON snapshot must be at most **512 KiB** to start sharing. Each Yjs replica/checkpoint and update is limited to **1 MiB**. These are byte limits, not character or exported-file sizes. Growing beyond a limit produces an error; keep a recovery copy and reduce the test document.
- This preview is for Docs content. It does not certify Sheets, Slides, PDF, Whiteboard, attachments, every formatting/import/export feature, Android, or every Windows Bluetooth adapter.
- Journal commits and local save status cannot protect data that was never committed. Browser-data deletion, profile changes, private browsing and device/disk loss can remove work. Export separate backups before important tests. Transport encryption does not encrypt browser storage or exported backups at rest.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| “Bluetooth sharing needs the Windows offline launcher” / “Open this page using the Windows offline launcher” | Save and close all Diwan tabs, launch the same complete package using `Start-Diwan-Offline.cmd`, and use `http://127.0.0.1:8765`. A hosted site, another port, or an older helper does not provide this bridge. |
| “No active Bluetooth radio” or the share button is disabled | Turn Bluetooth on in Windows Settings, leave airplane mode off or re-enable Bluetooth, then choose **Refresh Bluetooth**. Check Windows can see the adapter. An adapter's BLE capability alone does not prove this RFCOMM path works. |
| No paired devices, or the host is missing | Confirm both laptops are paired in Windows Settings, Bluetooth is on, then choose **Refresh Bluetooth**. Diwan lists paired devices; it is not a discovery/pairing screen. |
| Four-digit code expired, locked or already used | On A choose **Share this document** again, tell B the new four digits and approve only B's expected request. The code lasts two minutes; three failed attempts lock it. Do not omit a leading zero. |
| Waiting for host approval, approval timed out or request rejected | Check A's Bluetooth dialog and the requesting device's actual address. Approve only the intended laptop within 30 seconds. After a failure, use a fresh code if the dialog says the previous one is unavailable. |
| Connection fails or stays at connecting | Verify both run the same extracted package, A is still waiting in its host session, B selected A, and the invitation is current. Keep both awake and close by. Choose **Disconnect**, start sharing again on A and use its fresh invitation on B. Record any displayed Windows error number if it still fails. |
| Invitation is incomplete, rejected, expired or does not match the Bluetooth identity | Copy the entire new `DBT1-` code from the current host session, or transfer its newly saved invitation file. An old invitation cannot authenticate a new host session. |
| Link connected but B is empty/waiting or edits are missing | Open the shared editor on both laptops and check local save and sync errors. Wait for **Other laptop acknowledged this version** after an edit. If necessary reconnect with a fresh invitation using the existing shared document. Do not treat link status as a successful data transfer. |
| Local save/journal/quota error or a size-limit error | Stop the test and download/export a recovery copy before closing. Restore storage availability or use a smaller test document. Do not clear browser data or assume the peer has a durable copy without its acknowledgement. |
| Document seems missing after an update | Check the browser/profile and exact origin/port used previously. Launch the updated full package after closing all old tabs. Documents live in browser storage, not the extracted package directory. |

## Two-laptop physical acceptance checklist

These checks are **pending**, not recorded passes. Record the package version, date, both Windows versions, adapter models, browser/profile, visible errors and results. Use a disposable document with distinct markers so missing or duplicate edits are obvious.

- [ ] Turn Wi-Fi off on both laptops, disconnect Ethernet/other internet access and keep Bluetooth on. Launch both complete packages locally.
- [ ] Join using the four-digit code, including a code with a leading zero. Confirm A identifies B, B remains unconnected until A approves, and rejecting a separate request prevents document access. Check code expiry and failed-attempt lockout on the actual devices.
- [ ] Host on A, join on B and open the shared editor on both. Confirm the document content arrives over the physical link, beyond merely seeing “connected.”
- [ ] A → B: add a unique sentence, apply bold/italic and create a paragraph or list. Confirm text and formatting on B and **Other laptop acknowledged this version** on A.
- [ ] B → A: add a different sentence and formatting. Confirm it on A and actual peer acknowledgement on B.
- [ ] Make simultaneous edits on both laptops, including different paragraphs and a deletion. Stop typing; compare complete text and formatting and confirm both converge with peer acknowledgement.
- [ ] Turn Bluetooth off on one laptop. Confirm the disconnected/local state. Make distinct edits on both while disconnected and wait for local saves.
- [ ] Turn Bluetooth on, establish a fresh host/invitation connection using the same shared document and reopen both shared editors. Confirm both disconnected edits survive, deletion/formatting converge, and each laptop obtains peer acknowledgement after another edit.
- [ ] Save locally and close all Diwan tabs on both laptops. Restart both laptops with Wi-Fi still off. Relaunch the same package with the same browser/profile/port and reopen the existing document. Verify each local copy survives before reconnecting.
- [ ] Reconnect with a fresh invitation after both restarts. Confirm complete convergence, then make another edit from each laptop and obtain actual peer acknowledgement in both directions.
- [ ] Record any radio loss, expiry, restart, formatting or storage failure. Do not mark the physical test passed if either laptop only reports a connection or a local save.

Automated protocol tests use injected TCP connections or `TestWire` simulations. They exercise framing, authentication, persistence and convergence logic; they do not establish that two Bluetooth radios successfully exchanged document data. The single-laptop radio/SDP probe is separate evidence and also does not satisfy this checklist.
