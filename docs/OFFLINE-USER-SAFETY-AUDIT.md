# Offline user safety and usability audit

1 November 2026. Scope: the Windows offline development application, with Docs as the verified editor. This covers beginners, keyboard users, limited storage, slower devices, and experienced users working across tabs and backups. It is a bounded audit, not proof that every possible situation or device is covered.

Current nearby status: the Windows-only preview now implements OS-authenticated/encrypted classic Bluetooth RFCOMM, a local loopback browser bridge, TLS 1.3 certificate-pinned invitations and opt-in persistent Yjs journals with reconnect resynchronization. The destination acknowledges an update only after its journal commits. Earlier “Bluetooth unavailable/unimplemented” and “journal pending” statements describe the original milestone. A real local probe verified the active radio, paired-device list, RFCOMM listener and SDP registration/removal; **no actual two-laptop document exchange has been verified**. See [WINDOWS-BLUETOOTH.md](WINDOWS-BLUETOOTH.md) for operation, limits and the pending physical checklist.

## Fixed scenarios

| Situation | Fix and evidence |
| --- | --- |
| First launch without internet/account/backend | Bundled executable and assets; packaged check with no cloud/document API or external requests; native controls stay on loopback |
| Beginner does not know where files live | Offline help explains browser profile, private browsing, shared-device access, saving and separate backups |
| Storage denial looks like an empty file list | Visible errors and Retry on home/file list; browser denial/retry test |
| Storage protection is refused | Show the actual refusal and backup advice; browser fault-injection test |
| Little browser storage remains | Warning from a storage estimate, explicitly labelled an estimate; browser test |
| Both file and draft writes fail | Unsaved error and restorable recovery download of current editor content; browser blocks both stores, downloads and restores the work |
| User leaves before the save debounce fires | Preserve a draft on in-app navigation; exit warning while pending; save attempt when hidden; delayed-save navigation/recovery test |
| Blank loading editor overwrites work | Read-only until content/draft checks finish; Save disabled while missing/loading; recovery and missing-document tests |
| Two tabs edit the same snapshot | Reject stale writes and provide recovery options; transaction and two-tab browser tests |
| Old save acknowledges newer edits incorrectly | Generation-aware acknowledgement and exact-token draft cleanup; race tests |
| Backup cannot be restored | Preview then restore as new copies, preserving existing documents/device identity; downloaded-backup round trip and transaction tests |
| Corrupt, deeply nested or incompatible backup | Validate all records/references before writing; atomic rollback on quota failure; parser and browser tests |
| Backup of an imported HTML document | Round-trip the existing HTML representation, retaining the editor's sanitization boundary; unit test |
| Accidental permanent deletion | Confirmation with Cancel; explanation of history/folder behavior; browser verifies Cancel and confirmed deletion |
| Menu clicks do nothing | Fixed hover-transform stacking above the click-away layer and grid/folder/list clipping; reproduced pointer events and browser regression tests |
| Touch user cannot find hover controls | Visible action controls on narrow screens and keyboard focus; narrow-screen menu test |
| Save status disappears on phones | Reflow topbar and retain Save/status; 360×740 Chrome test at 4× CPU slowdown |
| Page margins leave a tiny phone writing column | Compact screen gutters; stored print/export geometry stays unchanged; mobile screenshot/edit check |
| Keyboard-only creation/help/save | Initial focus, labelled title/editor, Tab containment, Escape/focus return and Ctrl+S; browser tests |
| Short window hides dialog actions | Scroll dialog bodies; keep header/footer within viewport; 640×400 browser check |
| Large mixed-language paste | Preserve Arabic, Hindi and emoji text; browser compares a roughly 9,000-character paste with committed content |
| Editor throws and leaves a blank screen | Recovery boundary with reload/file-list actions, without resetting file state; intentional render-failure test |
| Slower device loads every office engine at startup | Load editors/settings when opened, precache chunks for offline use; measured main JS entry ~2.4 MB → 240 KB; offline restart regression passes |
| Offline controls imply unsupported services work | Cloud sharing/comments/suggestions and remote-image controls remain unavailable; Windows Bluetooth has a separate explicit sharing flow and actual local-save/peer-acknowledgement states. A connected link alone is not a synchronization success. |
| Old background server keeps serving an old package | Version-aware launcher replaces only a verified LocalFirst asset server at the same origin; Go health/version check and launcher verification |
| Cached update arrives during editing | Pending-update message and save/close/reopen instructions; no forced activation during editing |
| Workspace backup mistaken for a Bluetooth invitation | Specific file-type error and instructions to create/find the invitation in Downloads; reproduced original generic error and verified exact export/import between browser profiles |
| Invalid file leaves a previously loaded invitation active | Clear the old code before reading a new file; rejected input keeps Connect disabled; browser regression test |
| Wrapped, BOM-prefixed or plain-text invitation | Normalize permitted whitespace and validate the complete bounded code; parser tests and native-generated export/import check |
| Expired host invitation offered for download | Disable copying/exporting when the host session is no longer listening or connected |

## Verification

The expanded Windows preview now passes the totals below. Protocol/replica tests use injected TCP/TestWire, and the two-editor browser test uses a test-only native-control stub. Actual radio/SDP and packaged-owner operation are checked separately on this laptop. Two-physical-laptop exchange remains unverified.

- TypeScript typecheck passed.
- **133 focused tests across 13 files passed**, including concurrent journal initialization/compaction, failed remote commits, delete-only acknowledgement safety, stale-editor guards, invitation parsing and existing local safety/integration checks.
- **18 real Chrome end-to-end tests passed**, zero skipped or flaky. These include exact invitation download/load, wrong-file and stale-code protection, shared-replica migration, offline reload, rename/history, formatting, concurrent edits and disconnected merge after both editor copies reload. Native transport is stubbed in the two-editor browser test.
- **13 Go nearby tests passed** for authentication, access controls, framing, socket wrappers, cancellation and deadlines. Stream tests use TCP, not Bluetooth hardware.
- Go loopback server checks passed, including actual bundle-version reporting.
- Portable executable passed the real radio owner-start/stop and offline journal-reload checks, without external/cloud API requests or page errors. Results: workspace parent `Diwan-offline-package-verification.json`; real radio probe: `Diwan-Bluetooth-Hardware.json`.

Browser evidence: `web/test-results/offline-report.json` and `web/test-results/offline-small-screen.png`. Reproduce with `npm.cmd run build:offline` and `npm.cmd run test:e2e:offline` from `web`. Restore validation tests are in `web/src/lib/offline/workspace.backup.test.ts`.

The phone viewport and CPU slowdown are emulation on this laptop, not proof of Android battery, memory, process-death or radio behavior. The smaller main entry is a build measurement, not a typing-latency or total-memory benchmark.

## Remaining release gates

1. **Nearby collaboration:** Windows RFCOMM, explicit OS pairing plus session invitations, and durable concurrent Yjs journaling are implemented as a preview. Physical two-laptop data transfer, formatting/concurrent-edit convergence, radio-loss recovery, both-device restarts and actual peer acknowledgement remain unverified. Native Android packaging/transport is still unimplemented. Ordinary local snapshot conflict protection remains distinct from the opt-in shared-document journal.
2. **Abrupt power/process death:** the latest edit before a durable commit can still be lost. Browser exit warnings do not guarantee crash recovery. Shared documents now persist incremental journals; physical abrupt-loss/recovery tests and Android process-death tests remain necessary.
3. **Backup scale:** restore accepts up to 32 MiB, 1,000 files, 1,000 folders, bounded nesting and the supported schema. Documents have a 16 MiB limit and retain 50 versions. Large-workspace splitting/streaming and schema migration are pending; check backup size before relying on large-workspace restoration.
4. **Privacy/storage:** deleting browser data or losing the device can remove local work. Application data and JSON backups are not encrypted at rest by this application. A shared unlocked profile exposes its files. Help explains profile ownership and separate backups.
5. **Device/accessibility matrix:** physical low-memory Windows/Android devices, NVDA/TalkBack, magnification, switch input, Android IME, eviction, sleep/wake and battery behavior need testing.
6. **Install/updates:** disconnected clean-machine installs, signing, multiple profiles, conflicting ports and multi-version upgrades remain release gates. After updating, save and close every LocalFirst tab/window, then reopen the launcher. Do not clear browser data to update.
7. **Other office/cloud features:** this does not certify every Sheets, Slides, Whiteboard, PDF, attachment or import/export feature. Vercel remains the earlier online deployment.
8. **Security/performance:** hostile-peer review, dependency review, large-document stress tests, p95 latency and a supported hardware matrix remain outstanding.

## References used for browser behavior

Storage protection may be refused: [StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist). Exit warnings are unreliable for mobile process death: [beforeunload lifecycle limits](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event). Dialog keyboard behavior follows the [W3C modal-dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/); this is not a full WCAG conformance assessment.
