# Offline / nearby implementation progress

Updated 1 November 2026. Long-term platforms: Windows laptops and Android phones. Current scope: Windows-to-Windows Bluetooth preview, pending physical two-laptop data-exchange validation. Follow [the Windows Bluetooth guide](WINDOWS-BLUETOOTH.md) for exact setup and the pending acceptance checklist. Earlier “Bluetooth unimplemented” or “journal pending” descriptions refer to the original local-document milestone.

The [user safety audit](OFFLINE-USER-SAFETY-AUDIT.md) records the expanded recovery, storage, keyboard, mobile and low-resource checks, with remaining release gates.

## Available now

The Windows development package contains a standalone executable and bundled application assets. Extract the same full ZIP on both laptops and double-click `Start-LocalFirst-Offline.cmd`. It serves bundled files on `http://127.0.0.1:8765`, with no cloud backend, account login, Node.js or Go runtime required. The loopback server and `/_nearby/` bridge are local to each laptop. Keep the `web` directory and launcher files beside the executable. After updating, save and close all LocalFirst tabs/windows, then reopen the launcher; keep the same browser/profile/port and do not clear browser data.

Documents use the browser profile's IndexedDB. They are not saved into the ZIP or alongside the executable. Keep the same browser profile and origin. Export the workspace before clearing browser storage. The persistent-storage button reports the browser's actual decision; it cannot guarantee protection from user deletion or disk failure.

Implemented:

- Transactional local document creation, editing and saving, with an acknowledgement only after commit.
- Local revisions, a bounded 50-version history, restoration, complete folder lifecycle, search, workspace JSON export and validated restoration as new copies.
- Fail-closed stale snapshot saves for unshared files, including a guard against an older editor overwriting a file after replica migration. Opt-in shared files instead merge durable Yjs updates.
- Exact-token draft acknowledgement, protection against blank loading-editor writes, and recovery before editing is enabled.
- Cached application launch and document reopening after offline refresh and browser restart.
- A separate offline build with network connections disabled and no fallback to cloud APIs.
- A bounded BLE fragmentation/reassembly codec from the original foundation milestone; the current native Windows link uses classic Bluetooth RFCOMM instead.
- Native OS-authenticated/encrypted Windows RFCOMM, TLS 1.3 with a pinned session certificate and 256-bit invitation secret, paired-device selection, and invitation copy/JSON transfer. The browser uses only its own loopback helper; the inter-laptop link does not use IP, Wi-Fi, BLE or cloud fallback.
- Explicit Docs opt-in through **Bluetooth → Share this document**, persistent Yjs journals, reconnect resynchronization, and peer acknowledgement only after the destination journal commits. Ordinary local documents keep their existing save flow. Limits: one document/one peer, 512 KiB source JSON, 1 MiB replica/update, 30-minute invitation/session.
- Visible storage failures, emergency recovery downloads, navigation recovery, deletion confirmation, accessible help and responsive save status.
- Lazy editor loading and recovery UI for render failures.

The existing Vercel deployment is still the earlier online version. Use the offline package to try this milestone. Sheets, slides, PDFs and every optional office feature have not been certified by these Docs-focused checks. Unsupported local API operations explicitly fail rather than pretending to complete.

## Verification evidence

Current results for the Windows Bluetooth preview are below. Native protocol/authentication and replica tests use injected TCP/TestWire simulations; the two-editor browser test stubs only the native transport. These are separate from the successful real, single-laptop radio/SDP and packaged-owner checks. No physical two-laptop document transfer has passed yet.

| Check | Result | Scope |
| --- | --- | --- |
| TypeScript typecheck | Passed | Web source and offline end-to-end tests |
| Focused Vitest suite | 133 passed across 13 files | Local safety checks plus journal concurrency/compaction, disconnected replica recovery, failed commits, deletion acknowledgements, lifecycle cancellation, stale-editor migration guards and invitation parsing/interoperability |
| Real Chrome / Playwright | 18 passed; 0 failed, skipped or flaky | Previous offline/safety scenarios plus replica migration/reload/rename/history, two isolated real editors converging over a test-only transport, and exact invitation download/load with wrong-file and stale-code protection |
| Go nearby tests | 13 passed | Native socket wrappers, framing, TLS invitation authentication, cancellation, deadlines and HTTP access controls; stream tests use TCP and are not radio-transfer proof |
| Go asset-server tests | Passed | Loopback binding/host restrictions, methods, assets, routes and API rejection |
| Actual packaged executable | Passed | Correct frontend/native versions; starts without Node/Go on PATH; real owner Bluetooth sharing starts/stops on this radio; editor content survives migration and offline reload; zero cloud/document API requests, external requests or page errors |
| Root Windows launcher | Passed on this laptop | Starts hidden local server and opens the browser |

Reproduce from `localfirst/web` in PowerShell using `npm.cmd`:

```powershell
npm.cmd run typecheck
npm.cmd test -- src/lib/offline/workspace.test.ts src/lib/offline/workspace.backup.test.ts src/lib/nearby/framing.test.ts src/lib/nearby/documentSync.test.ts src/lib/nearby/invitation.test.ts src/store/__tests__/filesStore.optlock.test.ts src/store/__tests__/filesStore.org.test.ts src/store/__tests__/filesStore.save-state.test.ts src/lib/__tests__/flags.test.ts src/lib/pwa.test.ts src/lib/__tests__/sanitizeStyleElement.test.ts src/__tests__/msw/docsEditor.integration.test.tsx src/components/__tests__/AppErrorBoundary.test.tsx
npm.cmd run build:offline
npm.cmd run test:e2e:offline
npm.cmd run package:offline
```

Run `go test ./cmd/localfirst-offline` from `localfirst` with Go on PATH. This workspace also has the portable toolchain at `../.tools/go/bin/go.exe`. Run `node ./Verify-Offline-Package.mjs` from the workspace parent to check the packaged executable on an isolated test port. That script closes its own test server; the user launcher uses port 8765.

Machine-readable evidence: `web/test-results/offline-report.json` and the workspace parent's `Diwan-offline-package-verification.json`. Screenshot: `Diwan-offline-foundation.png` in the workspace parent.

## Hardware findings and remaining gates

The current Windows laptop reports an Intel Wireless Bluetooth adapter. The earlier WinRT BLE capability flags were only capability evidence. The current real native probe verified an active radio, enumeration of paired devices, RFCOMM listener creation and SDP service registration/removal. These single-laptop checks do not establish peer connectivity or document exchange. No actual two-laptop Bluetooth data exchange has been verified, and no Android APK has been built or tested.

Remaining work and validation gates:

1. Run the physical two-Windows-laptop checklist with Wi-Fi/internet off: formatted edits in both directions, simultaneous edits, radio loss/reconnect, both restarts, convergence and actual peer journal acknowledgements. Keep simulation and hardware evidence separate.
2. Expand Windows recovery/security/stress evidence for abrupt process/power loss, permission changes, sleep/wake, storage exhaustion, malformed peers, repeated reconnects, document limits and upgrades. Measure typing and propagation latency before making performance claims.
3. Implement and validate Android packaging/native transport separately. The current Windows RFCOMM preview does not establish Windows-to-Android or Android-to-Android support.
4. Complete the supported hardware matrix, disconnected clean-machine installation, threat/dependency review and release recovery/rollback gates.

A disconnected clean-machine install, Android process/storage behavior, threat-model review, malicious peer tests and the supported hardware matrix remain release gates. This is an implemented Windows Bluetooth preview awaiting physical peer-data validation; it is not a production-ready Bluetooth collaboration release. See [the full implementation plan](OFFLINE-NEARBY-PLAN.md) for broader acceptance criteria.
