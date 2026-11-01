# BIOS2026: presentation, demonstration and technical defence

Prepared on 1 November 2026 for the current local development workspace. This is a rehearsal guide, not a record that the proposed physical tests have passed. Read the [technical handbook](PROJECT-HANDBOOK.md), [competitive analysis](USP-AND-COMPETITIVE-LANDSCAPE.md), and [200-question bank](JUDGES-QUESTIONS-AND-ANSWERS.md) alongside it.

## 1. The message to remember

**Working proposition:** an extension of the original open-source [Diwan office suite](https://github.com/vul-os/diwan) that lets a Windows user keep editing and saving documents locally, then explicitly share a Docs replica over authenticated Bluetooth. A separate Android relay prototype forwards the endpoints' encrypted stream over a manually selected path. Longer range, automatic routing and production certification are future validation work.

Lead with the user's problem: a document should remain usable when Internet service disappears. Then explain the engineering contribution: local commits, recoverable drafts, conflict handling, durable collaborative updates and clear acknowledgement states. Discuss the radio and relay work after the audience understands what is being protected.

The project is not a new radio technology, a new cipher, a new CRDT, or a claim that offline editing has never existed. Its defensible contribution is the integration and validation of a particular workflow. Existing solutions deserve credit for the capabilities they already provide.

## 2. Three presentation lengths

### A. Thirty-second introduction

“BIOS2026 extends the original open-source [Diwan office suite](https://github.com/vul-os/diwan) for a local-first workflow. A Windows user can create, edit and save a document without an Internet account or cloud document API. For nearby collaboration, we added a native Bluetooth path with authenticated encrypted sessions and durable Yjs updates. We also built an experimental Android forwarding app. The app and protocol have software-test evidence; long-distance radio performance is not yet measured.”

### B. Ninety-second pitch

“Our target situation is a classroom, workshop or field team where an Internet connection is unreliable but people still need to work on a document. Traditional offline editors already solve individual editing. Our focus is joining local document ownership with nearby collaboration and recoverable state.

“We started from LocalFirst rather than claiming to build a complete office engine from scratch. The extension adds a separate offline Windows package, browser-local storage, exact save acknowledgements, recovery drafts and a native Classic Bluetooth connection. Shared documents keep a durable Yjs update journal. Reconnecting peers exchange state vectors and missing updates, and the destination acknowledges an update after its journal commit.

“The next prototype uses Android phones as consenting relays. A phone receives a relay access code, not the document invitation, and forwards the original endpoint TLS stream. That is a fixed route, not automatic mesh discovery. We have passing software checks and a built APK; we still need the physical multi-device and range trials. Our next milestone is measured evidence, not an unsupported one-kilometre claim.”

### C. Three-minute structure

| Time | Show or say | Purpose |
| --- | --- | --- |
| 0:00–0:30 | Describe an Internet outage during document work; introduce BIOS2026 and its LocalFirst base. | Establish the problem and attribution. |
| 0:30–1:15 | Disconnect Internet, type in a test document, wait for local save, then reload. | Demonstrate the strongest independently checkable local behavior. |
| 1:15–1:55 | Show the offline architecture: browser storage on the same machine; Go helper on loopback; Bluetooth between machines. | Explain why a localhost page can work without Internet. |
| 1:55–2:25 | Show the host invitation controls and explain pairing plus pinned TLS. If a physical peer has not passed rehearsal, stop at host setup. | Separate implementation from verified transfer. |
| 2:25–2:45 | Show the Android relay build and software-test evidence with an “experimental” label. | Present the extension without treating a simulation as hardware proof. |
| 2:45–3:00 | State the next gate: a real Windows–phone–Windows trial, then field measurements. | End with a concrete, testable development milestone. |

## 3. Ten-minute demonstration, minute by minute

Prepare two small disposable Docs documents. Use synthetic text such as “Disaster drill notes — demonstration only.” Do not use personal documents, production credentials or a real invitation in a projected code listing. Keep one person responsible for the keyboard and one for narration if a team is presenting; this is a suggested arrangement, not a claim about actual team membership.

| Minute | Demonstration action | Narration and pass condition |
| --- | --- | --- |
| 0–1 | Open the current Windows package and identify the offline workspace bar. | “This is the offline build, served locally at port 8765. The full inherited online product is a separate mode.” The correct UI and document list must appear. |
| 1–2 | Disable Internet connectivity and create a Docs document. | “Bundled application assets and IndexedDB let us work without fetching a cloud API.” The editor must become editable after loading and recovery checks. |
| 2–3 | Type a paragraph, save, then reload that document. | Explain the difference between typing in memory and a completed local transaction. The same content must reappear with a valid save state. |
| 3–4 | Export the workspace and briefly show the restore preview. Cancel the preview unless restoring a disposable copy is part of rehearsal. | “A backup is a separate local file. Restore creates new copies, preserving the existing documents.” Explain that a workspace backup is not a Bluetooth invitation. |
| 4–5 | Pair laptops beforehand; on the host open Bluetooth → Share this document → Save invitation file. | “The invitation contains the host certificate fingerprint and an authentication secret. It is a capability, so we transfer it privately.” Host listening and invitation download are the minimum verified setup result. |
| 5–6 | **Only if the physical test passed rehearsal:** on the receiver select the paired host, load the invitation, connect and open the shared document. | A connected radio is insufficient. Identify the shared document and inspect the endpoint acknowledgement state. If the physical test has not passed, show a clearly labelled protocol/browser test instead. |
| 6–7 | **Only on a rehearsed physical link:** edit different text on both endpoints; disconnect the link, edit locally, then reconnect. | Look for equivalent content and authenticated destination commit acknowledgements. Explain that a CRDT preserves mergeable operations; it does not guarantee that the resulting prose is semantically ideal. |
| 7–8 | Display the relay diagram and, if available, the Android app's consent, neighbor selection and Stop controls. | “The phone is a relay prototype, not an Android document editor. It does not receive DBT1.” If no device trial exists, use the actual APK/build evidence rather than an animation presented as a live network. |
| 8–9 | Show the software evidence summary and its separate hardware column. | Cite 19 recorded Chrome scenarios, the focused test report, the 230 phase-one relay executions, 108 JVM core checks and 27 tagged connector executions in their correct scopes. Do not add them into one misleading coverage percentage. |
| 9–10 | Explain the strongest competitor overlap, current limitations and next release gate. | “Offline editing, E2EE and Bluetooth messaging already exist. Our integration targets this document workflow. We still need physical range, battery, device and independent security validation.” Invite the judges' hardest architecture question. |

The minute ranges are a rehearsal schedule, not latency promises. A slow or disconnected radio may need more time than the allotted demonstration segment. Do not change a failure into a success claim to stay on schedule.

## 4. Preparation checklist

### Twenty minutes before presenting

1. Launch the exact packaged build you rehearsed. The historical parent-workspace launcher is `Start-Diwan-Offline.cmd`; newly generated LocalFirst packages use their own `Start-LocalFirst-Offline.cmd`. A fresh clone can instead build the Windows package using the commands in section 7.
2. Confirm `http://127.0.0.1:8765/healthz` reports the expected offline server and version. Health only proves the local server is responding; it does not prove radio delivery.
3. Use the same browser profile as rehearsal. Browser storage is scoped to that profile and origin. Avoid private/incognito mode for the working demo.
4. Save and export any valuable work before testing failure scenarios. Use synthetic demonstration documents for all destructive or recovery examples.
5. Check the radios, power supplies and explicit Windows pairing. Keep phones charged if they are part of the trial. Do not assume a phone's model name proves simultaneous-link support.
6. Install only the experimental APK you inspected. It is debug-signed and intended for development trials, not an audited production distribution.
7. Transfer document invitations privately. A projected invitation or copied relay code can grant access within its applicable session and admission conditions.
8. Prepare an offline copy of this guide and the actual evidence JSON reports. Explain recordings as recordings and tests as tests.

### Two minutes before presenting

Verify the correct browser tab, display scaling, readable editor, named test document and a clean demonstration route. Keep the stable app on port 8765. The experimental receiver uses port 8768 with a separate browser store; the verification smoke server uses port 8769 and is closed afterward. Opening the experimental workspace does not import the stable workspace's browser documents automatically.

Do not clear browser data to solve a cached-interface problem. Use the updated launcher's `/api/offline-launch` page. That route was chosen because the released old service worker bypasses `/api/`, allowing the native helper to deliver the current launcher even when the cached Home page is old.

## 5. Failure handling in front of judges

| Failure | Immediate response | Explanation that remains accurate |
| --- | --- | --- |
| The page shows the old “Nearby sharing not connected” label. | Open the updated launcher page, preserving the profile. | The asset cache is older than the local server; this is different from a failed radio. |
| Bluetooth is unavailable. | Continue with local editing and report the unavailable radio state. | Offline editing does not require Bluetooth. Nearby collaboration does. |
| No paired device appears. | Check OS pairing and refresh the device list. | The app enumerates paired devices; it does not silently take over arbitrary devices. |
| Loading the selected JSON fails. | Check whether it is a workspace backup, connection report or invitation. | Each format serves a different purpose; rejected files must not leave a stale invitation active. |
| The link is connected but the peer has no current content. | Keep both document editors open and inspect endpoint sync state. | Socket connectivity is not proof of replica synchronization or destination commit. |
| The local save fails. | Keep the document open and download its recovery copy. | A failed storage commit must not be labelled “Saved.” |
| A previous-session draft appears. | Restore or explicitly discard it before editing. | Recovery precedes editing so a blank loading state cannot replace unsaved work. |
| The Android relay stops after screen-off. | Report the observed device behavior and restart explicitly if appropriate. | Power-management and process lifecycle behavior remain physical-device gates. |
| The relay code expires or a phone restarts. | Generate a fresh code and reconnect the experimental receiver. | DRL1 is session admission; restarting a relay invalidates the old token. |
| A judge asks for 800 m immediately. | Show the planned measurement protocol and the empty range result. | The current evidence has `measuredRangeMetres: null`; no field result has been established. |

An honest bounded demo is stronger than changing the claim after a failure. The best response is: “Here is the state we expected, here is the state we observed, and here is the log or test that will tell us why.”

## 6. How to answer a difficult question

Use four short parts:

1. **Claim:** state the property you mean, with its mode and scope.
2. **Mechanism:** name the data flow or algorithm that creates that property.
3. **Evidence:** point to a specific source file, test or measured artifact.
4. **Boundary:** explain what that evidence does not establish.

Example: “The nearby protocol acknowledges a received update after the destination journal commit. `NearbyDocumentSync.receive()` applies the update and awaits `LocalReplica.flush()` before sending the acknowledgement. Protocol tests cover failed commits and lost acknowledgements. That does not certify all disk controllers or power-loss cases, and it is not a benchmark of real Bluetooth range.”

If you do not know an answer, name the uncertainty and the next experiment. Do not say that Go, TLS or Yjs automatically makes the entire application correct. Each library has an integration boundary that the project still owns.

### Eight questions to rehearse first

| Question | Short answer to practise |
| --- | --- |
| “What did you build rather than inherit?” | The offline packaging and storage path, recovery/save behavior, native Bluetooth bridge, nearby replica persistence/sync integration, invitation/update usability fixes and the experimental relay work. The editor engines and substantial office/backend code are inherited from the original Diwan project and its dependencies. |
| “Why not use Google Docs or LibreOffice?” | They are useful solutions with existing offline capabilities. The chosen design targets an explicit browser-local document workflow and a nearby Bluetooth transport that does not rely on a cloud document API. The comparison is about fit, not universal superiority. |
| “Is your encryption unbreakable?” | No absolute guarantee is justified. The design uses existing TLS 1.3 with a pinned host certificate and invitation authentication, while endpoint compromise, stolen invitations, traffic metadata and denial of service remain concerns. |
| “Have you achieved one kilometre?” | No. The target is a field-validation goal; simulated relay counts do not measure metres or area coverage. |
| “Can any nearby device extend it?” | No. A node must run compatible relay software, have power, permission and owner consent, and maintain working adjacent links. |
| “Is this Bluetooth Mesh?” | The current experiment is an application-level fixed-route RFCOMM overlay. It does not implement the Bluetooth SIG Mesh protocol. |
| “Does your Android app edit documents?” | No. The current Android experiment is a stream relay. The two Windows endpoints run the document session. |
| “Can a judge rebuild all of this from GitHub today?” | The Windows offline source/build path is versioned. At commit `d7e9135`, Android Java sources were accidentally excluded by a broad ignore rule and some experiment helpers remain outside the nested repository. That reproducibility gap must be corrected before claiming a clean-clone Android build. |

## 7. Operation and reproduction commands

These commands assume the documented prerequisites are installed. Installing dependencies and downloading SDKs may need Internet initially; running the packaged offline app afterward is a separate claim.

### Windows offline source build

From the repository's `web` directory in PowerShell:

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd run typecheck
npm.cmd run build:offline
npm.cmd run package:offline
```

Node/npm and an appropriate Go toolchain are needed for the build. `scripts/package-offline.mjs` accepts `GO_BINARY`, uses the workspace portable Go if available, and otherwise uses `go`. The resulting complete package includes its launcher; extract/copy the full package instead of copying only its executable.

### Read local health without exposing an invitation

```powershell
Invoke-RestMethod http://127.0.0.1:8765/healthz
```

### Targeted checks used in this workspace

```powershell
# From the main repository, with Go on PATH:
go test ./internal/nearby ./cmd/localfirst-offline
go test -tags relay_experiment ./internal/nearby ./cmd/localfirst-offline ./cmd/localfirst-relay-experiment

# From web, after building the offline assets:
npm.cmd run test:e2e:offline
```

The parent workspace also contains `Verify-Relay-Phase1.mjs`, `Verify-Relay-Experiment.mjs`, `Verify-Offline-Package.mjs` and `Verify-Offline-Upgrade.mjs`. Those scripts produced the recorded local evidence, but they are not part of the published nested repository at `d7e9135`. Their existence in the workspace is not a clean-clone guarantee. The handbook's reproducibility section records the missing packaging/source work.

## 8. Evidence to carry into the room

| Evidence | What it supports | What it does not support |
| --- | --- | --- |
| `Diwan-offline-package-verification.json` | Recorded 19 Chrome cases; packaged executable; local radio owner start/stop; native invitation download/import; offline reload. | A completed two-physical-laptop data exchange. |
| `Diwan-offline-upgrade-verification.json` | Reproduced old cached interface; current launcher activated new UI while preserving a saved document. | Every possible browser/version upgrade. |
| `Diwan-relay-phase1-verification.json` | 23 distinct simulated relay scenarios repeated ten times, plus scope-labelled baseline checks. | 230 distinct scenarios or any measured radio distance. |
| `Diwan-relay-experiment-verification.json` | 108 JVM checks, nine tagged Go leaf scenarios repeated three times, lint zero, APK signature/permission checks and isolated Windows UI smoke. | Physical Android forwarding, Android document editing, range or production certification. |
| The historical focused-test summary in the safety audit | A recorded focused run of 133 tests across 13 files. | A fresh full-project test run every time the count is quoted. |
| Source commit `d7e9135` and upstream base `8cdb6f5` | Reviewable inheritance and implementation delta. | A percentage of original authorship or proof that every locally built artifact is already in Git. |

Keep the primary reports locally. This guide summarizes their scope; it is not a replacement for the test outputs or an independent audit.

## 9. Next milestones and measurable acceptance

The first physical milestone uses one Windows host, one Android relay and one Windows receiver, with the phone maintaining both secure adjacent sockets. Check formatted content and actual endpoint acknowledgements in both directions. Then stop a link, edit locally on both endpoints, reconnect and inspect convergence. Repeat independently on the Samsung A36 and OnePlus Nord, recording exact Android builds rather than assuming support from product names.

Only after that should a two-phone chain be tried. Longer-range trials require surveyed node positions and a working link between every adjacent pair. For a route of length `D` and a measured usable spacing `r`, a simple lower-bound estimate is `ceil(D/r)` links and one fewer intermediate node. That estimate omits obstacles, placement constraints, interference, redundancy and mobility. A route reaching a point 800 m away is also different from full coverage of an 800 m radius.

Performance acceptance needs named hardware and workload: endpoint commit latency, acknowledgement delay, bytes per update, reconnection duration, throughput per hop, battery drain, memory growth and failure recovery. No p95/p99 performance number should appear in the pitch until the measurements exist. Security release work includes independent review, dependency/toolchain checks, source reproducibility, release signing and a tested rollback path.

## 10. Presentation conduct and ownership

Credit the upstream Diwan office suite and the libraries used for editing, CRDTs and cryptography. Explain that AI assisted implementation and documentation in this development session if asked about tooling. AI assistance does not transfer responsibility for understanding the code, validating claims, handling secrets or reporting failures.

Do not invent user interviews, revenue, deployment counts, benchmark results, certifications or team contributions. For business questions, frame the proposed customer segment and pricing model as hypotheses to test. For production questions, explain which gate has passed and which is still open.

The strongest closing sentence is a specific commitment: **“The next result we need is a repeatable physical Windows–Android–Windows document exchange with destination commit acknowledgements, followed by measured field range.”** It describes a testable milestone without turning a roadmap into a completed feature.
