# BIOS2026 / LocalFirst: USP and competitive landscape

**Prepared for judges · 1 November 2026 · Evidence baseline: `d7e9135`**

This chapter explains what problem this version addresses, which alternatives already solve parts of it, and which differences can be defended today. Competitor capabilities below come from the linked primary sources checked for this guide. They are a targeted comparison, not a feature-complete product audit or a patent novelty search. Capabilities, editions and deployment requirements can change.

## 1. The problem we are choosing to solve

A team may need to produce a shared report when Internet connectivity is unavailable, unreliable or deliberately excluded. Simply being able to open a document offline does not solve the whole workflow. Users also need to know whether the latest edit reached durable local storage, whether another device received and saved it, and what happens if the connection disappears halfway through an update.

The project explores a local document workflow with three separate responsibilities:

1. **Keep working locally:** the editor, document store and recovery mechanisms should function without an account server or cloud document API in the offline build.
2. **Exchange changes over an explicit nearby link:** the current Windows implementation uses paired Classic Bluetooth RFCOMM and an authenticated TLS session.
3. **Report evidence of delivery honestly:** a connection indicator is different from a destination journal acknowledgement.

The longer-term relay work asks whether participating Android phones can extend that path while forwarding opaque endpoint-encrypted bytes. That is a research and engineering direction; an 800 m or 1 km coverage claim is not a current result.

## 2. The claim ladder: working, experimental and proposed

| Level | Defensible statement | Evidence and boundary |
| --- | --- | --- |
| Current local workspace | The Windows offline package can create, edit, save, reopen and export Docs documents using local browser storage. | Packaged-app checks and 19 Chrome scenarios are recorded; this does not certify every editor or all devices. |
| Current nearby implementation | The code implements Windows RFCOMM, explicit pairing and invitations, pinned TLS 1.3, opt-in Yjs journals and destination commit acknowledgements. | Native owner listening and invitation download/import were checked on one radio. A complete physical two-laptop document exchange has not been independently recorded. |
| Simulated protocol evidence | The relay lab exercises end-to-end communication over multiple injected byte-stream hops and rejects several credential, mutation and replay failures. | 23 leaf scenarios repeated ten times means 230 test executions, not 230 distinct attacks or physical deployments. |
| Experimental Android relay | A separate Java relay APK and a tagged Windows receiver have been built. The phone forwards a manually selected circuit and does not terminate the document TLS session. | Android lint has no issues; JVM and Go protocol checks pass. Actual Android radio, service lifecycle and cross-device relaying remain unverified. |
| Future network capability | The project targets a measured 800 m route, with a possible 1 km stretch goal, using cooperating nodes. | No measured distance, automatic discovery, dynamic route repair or full-radius coverage result exists. |
| Production claim | The product has a staged path toward deployment readiness. | It is not production-certified, independently security-audited or supported across a published hardware matrix. |

The evidence sources are the local [package verification](../../../Diwan-offline-package-verification.json), [relay lab report](../../../Diwan-relay-phase1-verification.json), [prototype report](../../../Diwan-relay-experiment-verification.json) and [physical test guide](../../experiments/android-relay/README.md). Keep their scopes separate when presenting results.

### The difference between feature presence and validation

A feature may exist in source without having passed its physical acceptance gate. A successful software simulation is valuable because it isolates protocol behavior. It cannot prove antenna range, Windows-driver interoperability, Android background survival or two simultaneous radio links on the available phones. This project benefits from making that distinction visible rather than turning every green test into a product claim.

## 3. A USP that can withstand follow-up questions

### The short version

> We extend an open-source office suite into an offline document workflow that separates local saving from peer delivery, adds authenticated Windows Bluetooth sharing, and experiments with consent-based Android relays that forward the endpoints' encrypted stream.

### The technical version

The distinguishing engineering focus is the combination of local transactional persistence, recovery-first editing, structured CRDT synchronization, a native non-IP nearby transport, and explicit destination durability acknowledgements. The experimental relay keeps endpoint trust separate from relay admission: a `DRL1` code admits a path, while the `DBT1` document invitation authenticates the actual document endpoint.

### The statement to avoid

Do not pitch this as the first offline editor, the first encrypted collaborative editor, the first Bluetooth mesh app, or the only system that works without a cloud provider. Existing products demonstrate all those individual ideas. The project must earn its differentiation through this specific workflow, implementation quality and measured user benefit.

### The proposed user benefit

The hypothesis is that a small local group can continue producing a shared document with fewer infrastructure dependencies and clearer recovery/delivery feedback. Whether that is easier, faster or more reliable than alternatives must be tested with users and physical devices. It is a value proposition to validate, not a measured outcome already achieved.

## 4. What is inherited, and what this version contributes

BIOS2026 is derived from [VulOS LocalFirst](https://github.com/vul-os/diwan). The local baseline is commit `8cdb6f5`; the pushed project history preserves that ancestry. LocalFirst already supplied the React office shell, editor integrations, Go server, storage infrastructure, signing-related functionality and existing WebRTC collaboration code. React, Yjs, ProseMirror and TLS are established technologies, not algorithms invented by this project.

The extension work visible against that baseline includes:

- An offline-only build and local API routing for browser-backed documents.
- Transaction-completion-based save reporting, revision conflict checks and token-aware draft recovery.
- Opt-in persistent Yjs replica journals and reconnect synchronization for shared Docs documents.
- A Windows native RFCOMM helper, narrow loopback control API and certificate-pinned document invitations.
- Invitation-file validation and a host document-selection flow.
- An offline-cache upgrade launcher that resolves the old-shell problem without clearing IndexedDB.
- A separate fixed-route relay experiment with Android consent, foreground service controls and bounded forwarding.
- Fault-injection, browser, protocol and package checks that document what has and has not been verified.

These contributions are system integration, persistence semantics, transport adaptation, usability and testing work. The team should demonstrate them using the [baseline comparison](https://github.com/Vasu-Gupta105/BIOS2026/compare/8cdb6f5...d7e9135), rather than claiming authorship of the whole office suite. The inherited [MIT](../../LICENSE-MIT) and [Apache 2.0](../../LICENSE-APACHE) license texts and third-party notices remain relevant. This is engineering attribution, not legal advice about every possible distribution arrangement.

**Reproducibility gap:** the Android Java application and core tests are present and buildable in the current local workspace, but the `d7e9135` GitHub snapshot does not contain all of those Java files because of an existing ignore-pattern interaction. Several workspace build/verification helpers also live outside the main repository. The published repository is therefore not yet a complete, self-contained reproduction of the local Android experiment. Do not call it a fully reproducible public Android release until this is corrected and verified from a fresh clone.

## 5. Capability comparison

**How to read this table:** “conditional” means setup, edition, transport or deployment matters. “Not established” means the cited materials did not demonstrate that exact capability; it does not prove the vendor has no such feature. “Not the cited workflow” describes the scope of this comparison. A server on a local network may work without public Internet while still being required for collaboration.

| Product or family | Local work without public Internet | Collaboration route in the cited material | Confidentiality relevant to comparison | Fit and gap for this project |
| --- | --- | --- | --- | --- |
| **BIOS2026 / LocalFirst extension** | Implemented and tested for local Docs workflow after package installation | Native Windows Bluetooth; Android fixed-route relay is experimental | Pinned endpoint TLS for document transport; local documents/backups are not application-encrypted at rest | Focused workflow and explicit commit acknowledgements; physical peer/range evidence still incomplete |
| [Google Docs](https://support.google.com/docs/answer/6388102?hl=en) | Yes, after supported-browser/profile offline setup | Service-backed synchronization; offline edits wait for reconnection | Do not infer endpoint-only cryptographic confidentiality from offline availability | Strong familiar collaboration; cited flow does not establish direct Bluetooth co-editing |
| [Microsoft Word / Microsoft 365](https://support.microsoft.com/en-us/sharepoint/get-started-with-sharepoint/document-collaboration-and-co-authoring) | Yes, with suitable desktop/mobile app and local document availability | Co-authoring through shared storage such as OneDrive or SharePoint | Depends on product and organizational deployment; not assessed here as a universal E2EE model | Mature desktop editing; nearby serverless document transport is a different target |
| [LibreOffice](https://help.libreoffice.org/latest/en-US/text/shared/guide/collab.html?DbPAR=BASE&System=WIN) | Yes, desktop files | Calc has simultaneous shared-file collaboration; other workflows vary | Local ownership does not itself prove encrypted exchange | Strong offline alternative; Calc sharing must not be erased from the comparison |
| [ONLYOFFICE](https://www.onlyoffice.com/desktop) | Yes, Desktop Editors | Connected platform for real-time co-editing | [Private Rooms](https://helpcenter.onlyoffice.com/desktop/security/desktop-private-room.aspx) provide a specific encrypted collaboration workflow | Offline editing and encrypted collaboration already overlap with the pitch; Bluetooth path is not established by these sources |
| [Nextcloud Office](https://docs.nextcloud.com/server/stable/admin_manual/office/index.html) / [Collabora](https://www.collaboraonline.com/faqs/) | Desktop/local-file options exist; server-backed online editing requires its service connection | Self-hosted document-server integration, potentially on a private LAN | Self-hosting, transport TLS and [file E2EE](https://docs.nextcloud.com/server/latest/user_manual/en/files/using_e2ee.html) are different properties | Strong control/administration story; operating without a document server is the narrower difference |
| [CryptPad](https://cryptpad.org/about/) | Full disconnected editing was not established by the cited sources | Encrypted collaborative documents through an instance | Browser-side end-to-end content encryption is a core feature | A serious privacy-focused office competitor; encryption alone is not a unique claim |
| [Syncthing](https://docs.syncthing.net/users/syncing) | Local files remain usable | Peer file synchronization when devices can exchange data | File synchronization security is separate from structured editor semantics | Can preserve conflicting file copies; not the same as operation-level rich-text merging |
| [Briar](https://www.briarproject.org/how-it-works/) | Yes, for its supported communication workflow | Direct synchronization over Bluetooth/Wi-Fi; Tor when Internet is available | End-to-end encrypted communication is part of its design | Strong evidence that private offline nearby communication already exists; core focus is messaging |
| [Bridgefy](https://bridgefy.me/faq/) / [bitchat](https://github.com/permissionlesstech/bitchat) | Their documented local communication modes do not require Internet | Participating-device nearby/mesh messaging | Review the exact product, message type, version and security documentation | Prior art for device relaying; not evidence that an office-document relay is automatically safe or ready |

This is a comparison of workflows, not a ranking of entire organizations. A mature alternative may be the better choice for many real users, especially when enterprise support, complex file fidelity, broad device support or established deployment experience matters.

## 6. What to say about each alternative

### 6.1 Google Docs

Google explicitly documents creating, viewing and editing Docs, Sheets and Slides offline after preparation in a supported browser and profile. Therefore “Google Docs stops working when the Internet disconnects” is an incorrect pitch. The narrower comparison is where edits are exchanged: this project's offline build is intended to use a native nearby link rather than rely on restoring connectivity to the document service. That is an architectural distinction, not proof that our editor is more capable or more usable. [Google offline instructions](https://support.google.com/docs/answer/6388102?hl=en)

**Judge answer:** “Google already has offline editing. Our focus is an explicit nearby document-exchange path and local/peer durability feedback. We still need physical validation and user studies to establish the practical advantage.”

### 6.2 Microsoft Word

Microsoft documents continued offline work and later synchronization, while co-authoring depends on suitable applications, formats and shared storage. Its documented Word workflow can surface conflicts after disconnected edits. Do not reduce Microsoft to “cloud only”: desktop Word is a substantial offline product, and SharePoint deployments introduce additional choices. Our research question is how to maintain a small group's document workflow without relying on a reachable shared document-storage service for the nearby exchange. [Microsoft co-authoring requirements and offline behavior](https://support.microsoft.com/en-us/sharepoint/get-started-with-sharepoint/document-collaboration-and-co-authoring)

**Judge answer:** “We are not replacing Word's mature feature set. We are exploring a different transport and persistence workflow for a narrow disconnected-team scenario.”

### 6.3 LibreOffice

LibreOffice is a direct counterexample to the claim that offline office work is new. Its Calc collaboration documentation also describes shared-file access by multiple users. Consequently, “LibreOffice cannot collaborate” is too broad. The project's intended difference concerns locally persisted rich-text CRDT updates exchanged through the specific authenticated Bluetooth path. That distinction must be demonstrated rather than inferred from the fact that one application runs in a browser and another is a desktop suite. [LibreOffice collaboration documentation](https://help.libreoffice.org/latest/en-US/text/shared/guide/collab.html?DbPAR=BASE&System=WIN), [shared-spreadsheet setup](https://help.libreoffice.org/latest/ug/text/scalc/01/shared_spreadsheet.html?DbPAR=SHARED&System=WIN)

**Judge answer:** “LibreOffice is a strong baseline. A fair evaluation should compare task completion and setup friction against a realistic LibreOffice workflow, not against an artificially restricted version.”

### 6.4 ONLYOFFICE

ONLYOFFICE documents offline desktop editing and platform-connected collaboration. It also documents Private Rooms, with encryption and particular desktop/server requirements. Therefore neither “office editing without cloud” nor “encrypted collaborative editing” is exclusive to this project. Our comparison should name the exact workflows: Bluetooth endpoint transport and experimental opaque relay circuits here, versus the cited connected-platform and Private Room workflows there. Edition, compatibility and deployment checks belong in an actual selection exercise. [Desktop Editors](https://www.onlyoffice.com/desktop), [Private Room requirements](https://helpcenter.onlyoffice.com/desktop/security/desktop-private-room.aspx)

**Judge answer:** “ONLYOFFICE already overlaps with several privacy and offline goals. Our proposed advantage is the nearby transport workflow, whose benefit still needs measurements.”

### 6.5 Nextcloud and Collabora

Self-hosted collaboration can keep infrastructure under an organization's control; “no public Internet” does not imply “no server.” Collabora describes a server-based online editing model and separate local/desktop options. Nextcloud documents multiple office integrations, so the engine and release must be specified instead of assuming one universal architecture. [Collabora FAQ](https://www.collaboraonline.com/faqs/), [Nextcloud office administration](https://docs.nextcloud.com/server/stable/admin_manual/office/index.html)

Nextcloud's documented file-E2EE browser limitations should not be confused with ordinary server-side encryption or with every office integration. These are different trust and editing modes. [Nextcloud file-E2EE documentation](https://docs.nextcloud.com/server/latest/user_manual/en/files/using_e2ee.html)

**Judge answer:** “A local document server may be a good solution when it is available. Our offline mode aims to avoid needing that shared server for the nearby document path.”

### 6.6 CryptPad

CryptPad is an especially important comparison because it combines collaborative office applications with browser-side end-to-end encryption and self-hosting. It directly refutes “we are the only private collaborative office suite.” The sources checked here establish those properties but do not establish a fully disconnected Bluetooth document workflow; the table therefore leaves that specific comparison unverified. CryptPad also has its own documented import/export behavior, which should be compared with real test documents rather than assumptions. [CryptPad overview](https://cryptpad.org/about/), [application interoperability FAQ](https://docs.cryptpad.org/en/FAQ.html)

**Judge answer:** “CryptPad is closer to our privacy story than many mainstream editors. We differentiate the explicit nearby transport and recovery workflow, while acknowledging its mature encrypted collaboration approach.”

### 6.7 Syncthing

Syncthing synchronizes files. Its documented handling of simultaneous differing file edits includes conflict copies. This is useful preservation behavior, not a bug to ridicule. A rich-text CRDT addresses a different layer: it represents editing operations inside a document so replicas can reconcile structured changes. That does not make the CRDT automatically superior for arbitrary files, large binary assets or backup use cases. [Syncthing synchronization and conflict behavior](https://docs.syncthing.net/users/syncing)

**Judge answer:** “Syncthing is a strong file-sync tool. Our feature is editor-aware reconciliation and destination journal acknowledgement within a document session. We should compare it on that task, not pretend file sync and collaborative editing are identical.”

### 6.8 Briar

Briar already demonstrates private peer synchronization without a central messaging server, using nearby transports when Internet connectivity is unavailable. Its own roadmap discusses broader distributed applications. It is therefore relevant prior art rather than an unrelated product. The distinction here is the current focus on a structured office document and its persistence/acknowledgement path. It is not a claim that our threat model, metadata protection or operational maturity exceeds Briar's. [Briar design overview](https://www.briarproject.org/how-it-works/)

**Judge answer:** “Briar validates the importance of private offline communication. We are adapting that general problem space to an office-document workflow, and our implementation still has important validation gates.”

### 6.9 Bridgefy and bitchat

Both are relevant examples of nearby or mesh-style messaging, so “phones forwarding messages” is not a new concept. A radio-distance figure advertised for another product must not be reused as our measurement. Likewise, different message types can have different privacy properties. bitchat's project security material explicitly discusses visible broadcasts and proximity observability; that is a reminder to examine the exact traffic model rather than equate “mesh” with confidentiality. [Bridgefy FAQ](https://bridgefy.me/faq/), [Bridgefy application explanation](https://blog.bridgefy.me/blog/how-does-the-bridgefy-app-work/), [bitchat source](https://github.com/permissionlesstech/bitchat), [bitchat security overview](https://github.com/permissionlesstech/bitchat/security)

**Judge answer:** “These products are prior art for nearby relaying. Our experiment carries the existing document TLS stream through selected relays, with no current claim of automatic mesh coverage.”

## 7. Where a defensible advantage could develop

The strongest path is to prove a workflow improvement, not accumulate technology names. A credible pilot might ask a pair of users to edit a small report, disconnect, make independent changes, reconnect and verify both local recovery and destination persistence. The comparison should include the best practical alternative available to those users.

| Candidate advantage | What would substantiate it | What would weaken it |
| --- | --- | --- |
| Lower infrastructure dependency | Successful setup and document exchange with public Internet, Wi-Fi and cloud services unavailable | Hidden cloud calls, difficult installation, unreliable pairing or an undeclared server dependency |
| Clearer save/delivery understanding | Users correctly distinguish local commit, connection and peer journal acknowledgement | Users interpret a relay byte counter as proof of document delivery |
| Safe disconnected editing | Equivalent document state after concurrent edits and reconnection, with recovery paths exercised | Lost edits, silent stale overwrites, blank hydration writes or false acknowledgements |
| Reduced relay trust | Captured synthetic payloads remain opaque; endpoint identity checks reject a malicious route | Invitation/key leakage, endpoint authentication skipped or readable document fields in route setup |
| Practical portability | Fresh-clone builds, signed test artifacts and repeatable supported-device results | Missing source, machine-specific build helpers or unsupported radio combinations |

These are proposed evaluation criteria. They are not claims of completed user research or statistically established superiority.

## 8. Target users and use cases: hypotheses to validate

**Small classroom or workshop groups:** a teacher or student team may need to maintain a shared report during a connectivity outage. A pilot must check whether installing the package and managing invitations is acceptable compared with using an existing offline editor and exchanging files.

**Field-reporting teams:** a small group may need nearby document exchange where network service is weak. Battery life, physical spacing, device availability and file-size constraints become central. The existing software evidence is insufficient to recommend this prototype for safety-critical operations.

**Organizations exploring data locality:** a team may prefer local control over documents. However, local storage does not itself provide encryption at rest, remote administration, identity management, retention policy or compliance. Those are product requirements to discover, not capabilities to imply.

**A disconnected collaboration research demonstrator:** this is the clearest immediate use. The implementation makes transport, durability and trust boundaries tangible, and the tests expose failure conditions that are often hidden by a simple “connected” badge.

For each potential audience, interview users before selecting the final market. Ask what they currently do during outages, how often the problem occurs, how long setup can take, which file formats matter, who owns the devices and who is responsible for backups. Do not present invented adoption counts, market size or willingness-to-pay figures.

## 9. Practical tradeoffs judges should hear

The current direct-sharing preview has a one-document/one-peer boundary, short-lived invitations and bounded update sizes. A chain of relays requires each adjacent radio link to work. Additional relays can add latency, failure points and battery cost; they do not create bandwidth or repair an empty physical gap.

The Android experiment uses a foreground service with explicit opt-in and Stop control, but no wake lock or battery-optimization exemption. Process termination and power management can break a route. Those choices make participation visible and avoid implying that other people's devices are available as infrastructure without consent.

The proposed 800 m target must become a measured route result under named conditions. An entire 800 m radius would be a different coverage test. Bluetooth range depends on radio/PHY choices, antennas, transmit power, receiver sensitivity and obstacles; another device's maximum range is not our supported range. [Bluetooth SIG range explanation](https://www.bluetooth.com/learn-about-bluetooth/key-attributes/range/)

Security also has layers. TLS protects the endpoint channel under its authentication assumptions; it does not eliminate traffic analysis, compromised endpoints, stolen invitations or malicious packet dropping. The [TLS 1.3 specification](https://www.rfc-editor.org/info/rfc9846/) explicitly distinguishes content confidentiality from hiding traffic length. These limits should shape the requirements rather than be hidden in small print.

## 10. Business and deployment model without invented numbers

The repository's license choices permit an open-source development model subject to their terms and the separate licenses of dependencies. Possible revenue hypotheses include installation support, managed maintenance, organization-specific integration, training and supported hardware deployments. These are options for customer discovery, not current revenue streams or guaranteed licensing conclusions.

A realistic cost model must count engineering support, signing and release infrastructure, device testing, regression maintenance, security review and incident response. “No cloud server for the offline document path” does not mean zero operating cost. Relays consume battery and radio capacity; users incur installation and coordination costs even when no subscription is charged.

Do not price the product during a judge answer unless the number is explicitly identified as an unvalidated proposal. A stronger answer is: “We first need to establish that the workflow solves a recurring problem and that the support cost is manageable. We would then test a support-led offering with a small pilot.”

Production distribution needs complete publishable sources, dependable builds, a secure update path and a support policy. The Android APK is currently debug-signed, so it should be presented as a development artifact. Signing a package identifies its signer and detects modifications; it does not prove that the application is secure.

## 11. Metrics that would make the next pitch stronger

| Question | Measure | Do not substitute |
| --- | --- | --- |
| Can users start successfully? | First-attempt task completion, pairing/setup time and reasons for failure | A developer's rehearsed demo |
| Are edits durable? | Recovery outcomes at each commit boundary, including quota failure and process termination | The fact that a save button was clicked |
| Are peers synchronized? | Equivalent structured state and destination journal acknowledgements after concurrent edits/reconnect | Connected socket or sent-byte counts |
| Does the relay help? | Direct versus one-relay versus two-relay success, latency and energy under the same conditions | Number of simulated hops |
| How far does it work? | Measured node positions and sustained document exchange over a documented route | An 800 m target or a competitor's radio specification |
| Is it usable under failure? | Recovery success, understandable errors and retained local work | A happy-path screenshot |
| Is the implementation ready to distribute? | Fresh-clone build, verified signatures, supported-device matrix and resolved security findings | Lint or compilation alone |

Keep local typing latency, local commit time, wire propagation and peer durable acknowledgement time as separate measurements. Report distributions such as p50/p95/p99 after choosing a reproducible workload. No such end-to-end performance distribution has been established by the current reports.

## 12. Hard judge challenges and defensible responses

**“What exactly is new if Yjs, TLS and Bluetooth already exist?”**

The contribution is their integration into a recovery-aware document workflow with explicit persistence semantics and a native nearby transport. We are not claiming invention of the primitives. The right test is whether this implementation solves the target task more effectively and safely than a practical alternative.

**“Is this just a fork with a different name?”**

It is a fork, and attribution is part of the presentation. The team should show the inherited baseline and the actual added modules, failure fixes and validation. Claiming the inherited editor or cryptography as original work would be wrong; dismissing all integration and reliability work would also miss the engineering being evaluated.

**“Why not use an existing offline office editor?”**

That may be the right choice for many users. Our narrower target is concurrent document state and nearby exchange with an explicit peer-commit signal. We need a user comparison to demonstrate that the extra setup is justified.

**“Why not use CryptPad or ONLYOFFICE encryption?”**

Those are serious overlaps. Our argument must concern the transport and persistence workflow, not the mere existence of encryption. We should also compare their access control, interoperability and deployment experience fairly.

**“Why not a local Wi-Fi server?”**

A local server or Wi-Fi network is a valid alternative and may offer better throughput. The current offline build intentionally explores a different link that does not require that shared infrastructure. A future transport choice should be driven by measured requirements, not loyalty to Bluetooth.

**“Can you use every phone around us as a repeater?”**

No. Relays must run compatible software, be powered, have permission and explicitly opt in. This is a cooperative network, not the ability to commandeer discoverable Bluetooth devices. The fixed-route prototype requires selected paired neighbors.

**“Have you proved 800 m?”**

No. The target is documented and the physical test plan exists. Synthetic multi-hop results isolate protocol behavior but have no distance unit. A supported range requires field measurements with the named hardware and conditions.

**“Is every byte secret?”**

The document-channel design keeps payload confidentiality at the endpoints, but traffic timing, volume and adjacent radio presence remain observable. Endpoint compromise and possession of an invitation also matter. We do not promise zero metadata leakage or an unbreakable system.

**“What stops a relay from lying about delivery?”**

A relay-ready byte and relay counters do not satisfy document delivery. The actual destination must authenticate, apply the document update and commit its journal before sending the relevant acknowledgement. Physical malicious-relay validation is still a release gate.

**“What can you demonstrate today without asking us to trust a roadmap?”**

Show local editing, committed saves, offline reload, recovery behavior, source/test evidence, invitation generation and the separately labeled experimental artifacts. Demonstrate a real two-device or relayed transfer only if it has actually been rehearsed successfully on those devices. Otherwise state the missing hardware evidence explicitly.

**“Does passing hundreds of tests make it production-ready?”**

No. Repetition, scenario breadth, physical validation and independent review are different forms of evidence. The current reports identify their transport stubs and open gates. Production readiness requires operational and adversarial evidence beyond the present software checks.

**“Can someone else build exactly what you showed?”**

The stable source is pushed, but the local Android experiment has a publication gap and some tooling is workspace-specific. We should fix those gaps and verify a clean build before promising a complete reproducible Android release. Being explicit about that is stronger than offering a repository link that cannot reproduce the demo.

## 13. A practical positioning checklist

Before the presentation, make sure every slide can answer four questions: Which mode does this describe? What evidence supports it? What trust or setup assumption is required? What remains unverified?

Keep the headline focused on the document workflow. Keep inherited work attributed. Keep the long-range target in the roadmap. Keep competitor comparisons specific to edition and deployment. Avoid unsupported security adjectives and unmeasured performance numbers. If a judge challenges a claim, show the code path or evidence boundary rather than adding a larger claim.

## 14. Primary-source reference ledger

All competitor and standards pages below were checked for this documentation on **1 November 2026**. Vendor descriptions establish advertised/documented capabilities; they are not independent benchmarks or security endorsements.

| Source | Why it matters |
| --- | --- |
| [Google Docs offline help](https://support.google.com/docs/answer/6388102?hl=en) | Verifies that offline editing already exists and has setup conditions. |
| [Microsoft co-authoring](https://support.microsoft.com/en-us/sharepoint/get-started-with-sharepoint/document-collaboration-and-co-authoring) | Separates offline editing from shared-storage co-authoring. |
| [LibreOffice collaboration](https://help.libreoffice.org/latest/en-US/text/shared/guide/collab.html?DbPAR=BASE&System=WIN) | Prevents the false claim that LibreOffice has no collaboration. |
| [LibreOffice shared spreadsheets](https://help.libreoffice.org/latest/ug/text/scalc/01/shared_spreadsheet.html?DbPAR=SHARED&System=WIN) | Documents shared-location requirements for the Calc example. |
| [ONLYOFFICE Desktop Editors](https://www.onlyoffice.com/desktop) | Offline desktop and connected collaboration overlap. |
| [ONLYOFFICE Private Rooms](https://helpcenter.onlyoffice.com/desktop/security/desktop-private-room.aspx) | Encrypted collaboration already exists in a specified product workflow. |
| [Nextcloud office administration](https://docs.nextcloud.com/server/stable/admin_manual/office/index.html) | Office integrations are deployment-specific. |
| [Nextcloud file E2EE](https://docs.nextcloud.com/server/latest/user_manual/en/files/using_e2ee.html) | Distinguishes browser/file encryption limitations from ordinary office editing. |
| [Collabora FAQ](https://www.collaboraonline.com/faqs/) | Server-based online architecture and local-product distinctions. |
| [CryptPad overview](https://cryptpad.org/about/) | Browser-encrypted collaboration and self-hosting are prior art. |
| [CryptPad FAQ](https://docs.cryptpad.org/en/FAQ.html) | Import/export behavior needs product-specific evaluation. |
| [Syncthing synchronization](https://docs.syncthing.net/users/syncing) | File conflicts are different from structured CRDT merging. |
| [Briar architecture](https://www.briarproject.org/how-it-works/) | Existing encrypted communication over nearby and Internet transports. |
| [Bridgefy FAQ](https://bridgefy.me/faq/) | Nearby mesh communication is existing product territory. |
| [Bridgefy application explanation](https://blog.bridgefy.me/blog/how-does-the-bridgefy-app-work/) | A vendor's range example is not this project's field measurement. |
| [bitchat repository](https://github.com/permissionlesstech/bitchat) | Open-source Bluetooth mesh messaging is relevant prior art. |
| [bitchat security overview](https://github.com/permissionlesstech/bitchat/security) | Message category and proximity metadata require careful distinctions. |
| [Bluetooth SIG range](https://www.bluetooth.com/learn-about-bluetooth/key-attributes/range/) | Range is hardware- and environment-dependent. |
| [IETF TLS 1.3, RFC 9846](https://www.rfc-editor.org/info/rfc9846/) | Endpoint encryption does not hide every traffic characteristic. |
| [Upstream Diwan](https://github.com/vul-os/diwan) and [project comparison](https://github.com/Vasu-Gupta105/BIOS2026/compare/8cdb6f5...d7e9135) | Separates inherited software from this version's contributions. |
