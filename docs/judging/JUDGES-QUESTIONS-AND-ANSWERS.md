# BIOS2026 / LocalFirst: 200 Judge Questions and Model Answers

**Prepared:** 1 November 2026. **Source reference:** `d7e9135` in [BIOS2026](https://github.com/Vasu-Gupta105/BIOS2026). **Audience:** students, product judges, software engineers, security reviewers and networking specialists.

This is a broad rehearsal bank, not a claim that every conceivable question can be predicted. Answers describe the available source and recorded evidence. Use “implemented,” “tested in software,” “tested on this radio,” and “physically validated between devices” carefully: they are different statements.

The current deliverable extends the open-source [original Diwan project](https://github.com/vul-os/diwan). Its strongest demonstrated path is a Windows offline Docs workspace with local persistence and recovery. Native Windows Bluetooth sharing exists as a preview. A separate Android relay APK and Windows receiver have passed software checks. Independent physical two-laptop document exchange, Android relay lifecycle, 800 m–1 km range and production security remain open gates.

## 1. Beginner questions: problem, purpose and scope

### Q001. What is this project in one sentence?

It is a local document workspace that keeps editing and saving available without an internet connection, with a Windows Bluetooth collaboration preview and an experimental Android relay path. The practical idea is that the user's own device remains the primary working copy. Long-distance relay coverage is a development target, not a result we have already measured.

### Q002. What problem are you trying to solve?

People can lose a useful collaboration workflow when internet access is unreliable, restricted or unavailable. This project separates local document durability from a network connection, then explores nearby exchange without using an internet server for document transport. It also addresses less visible failures: stale tabs, misleading save indicators, confusing invitation files and interrupted application updates.

### Q003. Who is the intended user?

Potential users include students, small teams and field groups who need to continue writing during connectivity gaps and retain control of local copies. Those are target segments, not proven paying customers or deployment partners. Before choosing a market, we would test whether document collaboration is actually their priority and whether they can maintain enough participating relay devices.

### Q004. What can I use today?

The Windows package can open its bundled interface, create and edit local documents, save them into browser storage, reopen them and export or restore a workspace backup. It also exposes the native Bluetooth sharing flow. The broader office suite has more inherited features, but our strongest offline verification concerns Docs, so we would not present every editor as equally certified.

### Q005. What does “offline” mean here?

For the Windows offline build, application assets are bundled and document operations use local browser storage rather than a remote document API. The browser still talks to a helper on the same computer for Bluetooth controls. Offline does not mean that communication needs no hardware, power or installation; it means the implemented local workflow does not depend on internet service.

### Q006. Is this a website or a desktop application?

The interface is a React web application served locally by a Windows executable. The browser provides the editing environment and IndexedDB storage, while the executable serves bundled assets and supplies native Bluetooth access. This combines a reusable web interface with a platform-specific helper. It is different from downloading an unknown public website for the first time with the internet disconnected.

### Q007. Is it a replacement for the whole Microsoft Office suite?

That is not the current claim. The upstream codebase includes several office editors, but this development effort concentrates on offline document safety and nearby collaboration. Mature commercial office products have extensive compatibility, accessibility, administration and deployment work behind them. We should compete on a specific validated workflow before claiming an equivalent full-suite replacement.

### Q008. What is the main benefit beyond just saving a file locally?

Local saving is only one part. The project adds explicit recovery behavior, revision conflict protection, a durable shared-document journal, visible peer acknowledgement and a nearby connection workflow. The intended benefit is continuing useful work through outages without confusing “a radio connected” with “the other device safely saved my edits.”

### Q009. Does the application need a user account?

The offline workspace does not need a cloud account or account server to create and save a local document. The inherited hosted application has separate authentication and deployment capabilities. Account-free local use does not provide account-based access isolation: another person using the same unlocked browser profile can access that profile's local documents.

### Q010. Have you achieved an 800-metre range?

No measured 800 m result exists in the available evidence. The relay lab exercised multiple forwarding stages in memory, which proves a limited protocol property rather than a physical distance. Actual coverage depends on adjacent radio links, obstacles, interference, device placement and cooperating nodes. We would only publish a distance after a documented field trial.

### Q011. Does the system automatically use every nearby phone?

No. A phone must run compatible relay software, have Bluetooth enabled, grant the required permissions and explicitly opt in. A headset, a discoverable device or a switched-off phone is not automatically a relay. The present Android prototype uses selected paired neighbors and a fixed route; automatic discovery and route selection are later work.

### Q012. What should judges remember most?

Our central engineering principle is to make durability and connectivity explicit. Work remains local when the network disappears, and the UI should only claim peer acknowledgement after the receiving journal commits. The Bluetooth and Android relay work explores how to extend that model while keeping document authentication between the actual endpoints, with remaining hardware limitations stated openly.

## 2. User experience and demonstration

### Q013. How does a beginner create and save a document?

The user opens the Windows offline launcher, creates a Docs document and starts typing. The editor reports its local save state, and Ctrl+S provides an explicit save action. A successful state follows local persistence, not an optimistic network animation. The user should keep the same browser profile and origin when reopening the application.

### Q014. Where exactly are my documents stored?

The offline documents live in IndexedDB inside the current browser profile for the local application origin. They are not stored inside the ZIP or automatically beside the executable. The stable launcher uses `http://127.0.0.1:8765`. A different profile, private window or port has a different storage context and may therefore show a different workspace.

### Q015. Which computer generates the document invitation?

The computer hosting the selected document generates it. The owner opens the document, chooses Bluetooth, starts sharing and saves the invitation file or copies the code. The receiving computer loads that invitation while selecting its paired host. The invitation authorizes access to that session; it is not an export of the document itself.

### Q016. How does the host find sharing from Home?

The workspace's Bluetooth dialog includes a document selector and an “Open document to share” action. That opens the chosen document with its sharing dialog available. Hosting still goes through the editor's preparation step so current work is saved before it is offered. The invitation export remains disabled until an active host invitation exists.

### Q017. Why are workspace backups and invitation files different?

A workspace backup contains saved document records and history for restoration. A Bluetooth invitation contains session authentication material, not the workspace. Treating the two as interchangeable caused a real usability failure, so the importer now identifies the wrong format and explains how to obtain the invitation. The filenames alone are not trusted; the contents and format version are checked.

### Q018. What is the difference between “saved” and “acknowledged”?

“Saved on this device” concerns a successful local persistence path. “Other laptop acknowledged this version” concerns the peer's authenticated document protocol and durable journal commit. A connection state or a relay's byte counter cannot establish the second property. The distinction matters when one device has full storage or disconnects immediately after receiving bytes.

### Q019. What happens if the user closes a tab immediately after typing?

The application attempts to preserve a recovery draft and warns about pending work where the browser allows it. Navigation and visibility changes have recovery handling, but browser exit warnings are not a guarantee against process death or power loss. The safe statement is that committed work is durable within the browser's storage guarantees; the newest uncommitted edit can still be lost.

### Q020. What does the recovery prompt do?

It asks the user to restore or discard a previously retained draft before editing proceeds. This prevents a newly loaded blank editor from silently replacing recoverable content. A draft is a recovery mechanism, not proof that the normal save succeeded. When storage itself is failing, the interface also offers a downloadable recovery copy where possible.

### Q021. How are keyboard users supported?

The implementation includes labelled document controls, keyboard save behavior and modal focus handling, including Escape and focus restoration. Browser scenarios exercise keyboard creation, help and saving. That is useful evidence, but it is not a full accessibility certification. Physical screen-reader, switch input and platform-specific accessibility testing remain part of a wider device matrix.

### Q022. How do you handle a user who selects the wrong invitation file?

The parser explains specific errors such as workspace backup, connection report, unsupported version, missing code or oversized file. Importing another file clears the previously entered invitation before reading it, so rejection cannot silently leave a stale credential active. Connect stays disabled until the input passes validation and the required host selection and radio conditions are satisfied.

### Q023. Why did an old screen remain visible after an update?

The browser's service worker could keep serving the previous application shell even after the local executable was replaced. The launcher now opens a startup route bypassed by earlier workers, updates the worker and checks its version before opening Home. Existing editor tabs are left open; application code caches and document databases are treated as separate concerns.

### Q024. What if the live Bluetooth demonstration fails?

We should show the local offline workflow first, then explain the connection status and failure rather than pretending success. The prepared software tests can demonstrate protocol behavior, but they must be labelled as simulations. For the physical feature, we would record the device and error, keep both local documents intact, and repeat the documented connection checklist after the presentation.

## 3. Technology stack and engineering choices

### Q025. What is the main technology stack?

The interface uses React, TypeScript, Vite and Tailwind CSS, with Zustand for application state. Docs uses Tiptap and ProseMirror, and shared-document synchronization uses Yjs. Go supplies the hosted backend and Windows helper, with native Windows Bluetooth socket calls. The Android relay experiment is a separate Java application built with the Android SDK and Gradle.

### Q026. Why use React rather than plain HTML and JavaScript?

The inherited interface already uses React, and the project has many stateful screens: file lists, editors, dialogs, recovery prompts and save indicators. Components make those interactions easier to organize and reuse. React does not provide durability or synchronization by itself, so those responsibilities remain in explicit storage and protocol modules rather than being hidden inside rendering logic.

### Q027. Why TypeScript?

TypeScript helps describe file records, save states, native messages and synchronization interfaces before the program runs. For example, a native message has a file identifier and an allowed kind rather than an arbitrary unstructured payload. Static typing improves development feedback, but it cannot make received Bluetooth or JSON data trustworthy; runtime validation is still required at every input boundary.

### Q028. Why Go for the helper and backend?

Go fits the existing backend and supports networking, concurrency, standard-library TLS and standalone executable packaging. The helper can serve local assets and own native sockets without requiring the end user to install Node.js or Go. Its goroutines simplify concurrent reads and cancellation, but correct ownership and limits still require careful design and tests; concurrency is not automatically safe.

### Q029. Why use a browser interface with a native helper?

The browser supplies the editing stack, storage APIs and a reusable interface, while the helper supplies native RFCOMM access unavailable through the current browser workflow. The boundary avoids rewriting the entire editor for Windows. It also creates a security responsibility: the local helper needs narrow operations, origin checks, authentication tokens and loopback-only exposure.

### Q030. Why not implement all Bluetooth access directly in the browser?

The current inter-laptop design uses Classic Bluetooth RFCOMM, while browser Bluetooth support is not a general equivalent to arbitrary native RFCOMM sockets. The existing implementation therefore uses Windows APIs behind a local bridge. A browser-only redesign would need a separately validated transport and capability model; merely changing the UI cannot provide unsupported radio roles or platform APIs.

### Q031. What do Tiptap and ProseMirror do?

They provide the structured rich-text editing model and commands behind the Docs interface. A document is a tree of nodes, marks and attributes rather than only a flat string. That structure matters when synchronizing formatting, paragraphs and tables. We reuse those editor primitives and focus our additions on offline persistence, recovery and the nearby synchronization path.

### Q032. What does Yjs contribute?

Yjs supplies a CRDT document model, binary updates and state-vector synchronization. It allows independently produced compatible updates to merge without choosing a single authoritative last saved snapshot. The application still has to validate updates, connect the model to the editor, persist its updates and decide when acknowledgement is justified. Yjs does not provide Bluetooth, application authorization or durable storage automatically.

### Q033. What is Zustand used for?

Zustand holds application state such as file lists and related operations used by the interface. It is an in-memory state management tool, not the database. The offline API and IndexedDB modules perform persistence, and the editor tracks save generations separately to avoid an old asynchronous save completion marking newer edits as saved. Those layers should not be conflated.

### Q034. What is Vite doing in the project?

Vite builds and splits the browser application and provides development tooling. The offline build selects the offline mode, disables the online collaboration path and produces bundled assets plus a generated service worker. The installed user runs those assets locally; Vite is not a required runtime service on the user's laptop. Building and running are separate lifecycle steps.

### Q035. Are all listed dependencies part of the demonstrated offline path?

No. The broader repository contains inherited spreadsheet, slide, whiteboard, PDF, import/export and hosted features, so its dependency list is larger than the verified offline Docs path. A good stack explanation identifies what a dependency actually does and in which mode it is used. Package presence alone is not evidence that a feature has been demonstrated or tested.

### Q036. How should you report library versions?

Use the manifest to explain declared requirements and the lockfile to identify the concrete resolved packages for a build. A range such as `^18.3.1` is not the same statement as the exact installed React version. For reproducible evaluation, record the source commit, lockfile, toolchain and artifact hashes rather than reading a badge as definitive runtime evidence.

## 4. Frontend architecture and mode boundaries

### Q037. What are the application's main layers?

The interface layer contains React views and editor controls. State and API adapters route file operations to the appropriate mode, while local workspace, draft and replica modules own persistence. The native bridge translates narrow browser requests into local helper operations. Below that, Go manages document sessions and Windows sockets; the Android experiment forwards opaque streams on a selected route.

### Q038. How does the offline build avoid calling the cloud document API?

An explicit offline build flag selects the local behavior before the ordinary server request path is used. Supported operations are handled through the local API adapter and IndexedDB, while unsupported operations fail visibly. The offline build also disables online endpoint priming and online Docs collaboration. Browser request monitoring checks that the tested workflow makes no external or cloud document requests.

### Q039. Is the inherited WebRTC collaboration path used for Bluetooth?

No. The repository retains its existing online or self-hosted peer collaboration architecture, but the offline build disables that Docs path and uses the separate native nearby interface. Bluetooth document updates travel through the helper's RFCOMM connection. Describing Bluetooth as WebRTC without internet would hide a real architectural difference and confuse both connectivity and trust boundaries.

### Q040. What is lazy loading, and why use it here?

Lazy loading delays editor engines and other large modules until their screens are opened. This reduces the JavaScript that must execute just to display Home. The offline build still bundles and precaches the relevant application assets for later disconnected use. A smaller initial entry does not prove that total storage, all editor memory usage or typing latency has become equally small.

### Q041. What is a service worker?

A service worker is a browser-managed script that can intercept requests for its origin and serve cached application resources. Here it supports reopening the app without reaching an internet server. It is not the document database and does not make local files immune to storage deletion. Its lifecycle also needs careful handling so an older cached interface does not hide a newly installed build.

### Q042. Why not save private documents in the application cache?

Application caches and document storage have different purposes and upgrade lifecycles. The service worker caches code, styles and other application assets; document records belong in IndexedDB with explicit transactions and recovery logic. Mixing documents into an asset cache would complicate access control, updates and deletion. Keeping them separate also makes it easier to explain what an application-cache replacement does to user work.

### Q043. What does the error boundary protect against?

It catches certain React rendering failures and presents recovery actions instead of leaving a completely blank application. It does not catch every asynchronous error or repair a corrupt database automatically. Its purpose is to keep the user oriented and provide a route back to files or reload, while the storage layer separately controls the integrity of saved document records.

### Q044. How do you stop blank content overwriting a loading document?

The editor remains read-only until file hydration and recovery checks are complete, and save preparation checks that a document is ready. An empty initial editor is not treated as an intentional edit to an existing document. This is a lifecycle problem as much as a storage problem: a perfectly valid database write can still destroy useful work if it writes the wrong loading state.

### Q045. How do you prevent an old save result from reporting newer text as saved?

The save flow records a dirty generation before starting persistence. If the user edits while that save is pending, the generation changes and the completion must leave the document dirty. Draft cleanup also checks its exact token. Together, those checks prevent an earlier operation from acknowledging or deleting recovery state belonging to a later edit.

### Q046. Why not show “synced” whenever the Bluetooth connection is active?

A live socket says that a transport exists; it says nothing about validation, application of the update or a receiving storage failure. The application therefore distinguishes link state, local save state and peer acknowledgement. This is especially important during reconnects and tests: an attractive green connection indicator would be misleading if the peer's journal had not committed the latest deletion.

### Q047. Can multiple tabs affect the same document?

Yes, so the design must treat tabs as concurrent actors rather than assuming one editor owns a record. Ordinary snapshot documents use revision checks to reject stale replacement writes. Shared replicas use a journal and cross-tab notifications, with compaction merging committed records inside the transaction. Tests cover several tab interactions, but that does not establish every possible browser scheduling behavior.

### Q048. What happens when an operation is unavailable in offline mode?

It should fail explicitly rather than returning a fake success or silently using an internet fallback. The offline interface hides or disables services that do not belong to that mode. The inherited online application may support more features, but those should not be advertised as available merely because the same codebase contains their components or server handlers.

## 5. Local persistence, recovery and database behavior

### Q049. What local databases are used?

The main workspace database is `diwan-local-workspace`, with stores for files, folders, metadata and versions. Recovery drafts use `diwan-drafts`, while shared document checkpoints and updates use `diwan-replicas`. These databases serve different responsibilities: snapshots and file organization, last-resort draft recovery, and the durable CRDT history needed for shared-document replay and resynchronization.

### Q050. What fields are in a local file record?

A record includes its ID, name, type, content, revision, ownership marker, parent folder, starred and trashed flags, and timestamps. Shared documents also carry nearby-related flags. The content field is not a universal plain-text blob: each editor may use its own representation. Validation and migrations must therefore respect the document type and schema rather than assuming every record is interchangeable.

### Q051. Why use IndexedDB rather than localStorage for document content?

IndexedDB supports asynchronous operations, structured values, indexes and transactions, making it more suitable for multiple document records and journals. localStorage is synchronous and does not supply the same transaction model. The choice does not remove quotas or eviction risks, so the application must still handle storage denial, write failures, profile changes and the need for separate backups.

### Q052. When does a database operation count as successful?

The workspace and replica transaction helpers resolve their result after the transaction completes. Receiving an object-store request's success callback alone is not enough if the enclosing transaction later aborts. This distinction is important for user-visible save state and for sending a peer acknowledgement: both must describe committed work, not merely a write request that was accepted temporarily.

### Q053. What does strict transaction durability mean?

For relevant read-write transactions the application requests IndexedDB's strict durability option. It is an expression of the desired storage behavior, not proof against hardware failure, browser defects or every power-loss scenario. We still distinguish an acknowledged transaction from an uncommitted edit and keep power-loss testing as a release gate. Storage guarantees must be explained in the actual browser and platform context.

### Q054. How is a stale snapshot write detected?

The update includes the revision that the editor believes it is modifying. Inside a transaction, the storage layer compares it with the current record's revision and rejects a mismatch instead of blindly replacing newer work. The error can include the current record for recovery decisions. This protects against lost updates but is not the same thing as automatically merging every concurrent edit.

### Q055. Why distinguish ordinary documents from shared replicas?

Replacing a whole snapshot is reasonable for an ordinary local file when revision checks protect concurrent tabs. A shared document needs mergeable operation history, so it explicitly opts into a durable Yjs replica. Keeping that migration explicit limits the effect on existing local files. An older snapshot editor is rejected after migration rather than being allowed to overwrite the new replica-managed document.

### Q056. What happens when a file is missing?

The storage adapter reports that the document was not found, and the editor should not become editable as though an empty replacement were the original. This matters because a blank document is valid data and could otherwise be saved successfully under the wrong assumption. The missing-file test checks the visible failure and verifies that editing or saving a blank replacement is not enabled.

### Q057. How are recovery drafts different from versions?

A draft is a recent recovery copy retained around an unfinished or failed save, while versions represent prior committed snapshots in the workspace history. A version does not necessarily contain the most recent unsaved typing, and a draft does not establish that the ordinary document record was committed. Each has separate cleanup, restore and user-interface behavior.

### Q058. Why attach a token to a draft?

Consider save A writing a draft, then the user making edit B before A completes. If A deleted the draft by document ID alone, it might erase B's newer recovery copy. The token identifies the specific draft associated with A, so cleanup deletes only that record if it still matches. Explicit user discard uses a separate intentional path.

### Q059. What happens when both document storage and draft storage fail?

The interface must remain honest about the failure and preserve the current editor content as far as possible. A recovery download provides a path that does not rely on the same failing IndexedDB write. Fault-injection browser tests exercise that behavior, but the downloaded file is still the user's responsibility to save and retain. Closing the editor prematurely can remove that remaining recovery opportunity.

### Q060. What does a workspace backup include?

The backup is a structured representation of saved local workspace data, including files, folders and relevant history and deleted-state records. It is separate from the application executable and the Bluetooth invitation. The import process validates the complete structure before committing restoration. A source-code checkpoint is another different artifact and does not automatically back up personal browser documents.

### Q061. Does restoring a backup overwrite current files?

The intended restore flow adds new copies with new identities rather than replacing the user's current workspace. It previews what will be restored and preserves existing work. This makes a mistaken restore more recoverable and avoids treating old backup revisions as authoritative current state. Repeating a restore can produce more copies, so that behavior should be explained instead of silently deduplicated.

### Q062. What are the important storage limits?

The workspace code limits individual document content to 16 MiB and retains at most 50 stored versions. Backup restore is bounded at 32 MiB, with limits on record counts and nesting. Nearby sharing has smaller limits of its own. These are application safeguards, not claims that the browser always has that amount of free storage or that every near-limit file has equivalent performance.

### Q063. Can browser storage be deleted even after a successful save?

Yes. A user can clear site data, lose the device or use a different browser profile; storage pressure and browser policy also matter. The app can request persistent storage and report the actual result, but it cannot make the data immortal. A separate exported backup remains necessary for work that must survive device or profile loss.

### Q064. Does changing from port 8765 to 8768 expose the same documents?

No, ports are part of a web origin, so those addresses use separate browser storage contexts. The experimental receiver deliberately uses port 8768 to isolate its workspace from the known working app on 8765. Users should not interpret an empty experimental file list as evidence that the stable documents were deleted. This separation is a safety boundary, not a synchronization feature.

## 6. CRDTs, journals and synchronization logic

### Q065. What is a CRDT in simple terms?

A conflict-free replicated data type represents changes so compatible replicas can combine independently produced updates according to defined rules. For a collaborative document, this lets two devices edit while disconnected and later exchange missing information. It does not mean every user's intended meaning is automatically preserved; the application must still choose an appropriate document model and show understandable results.

### Q066. Why not just send the latest entire document and replace the other copy?

If both devices edit independently, replacing one whole snapshot with the other can discard valid work. Shared replicas instead exchange Yjs updates and merge them. Full-state updates may still be used for synchronization barriers, but they are CRDT state encodings applied through the CRDT machinery, not an instruction to overwrite a peer's unrelated concurrent operations with a plain JSON snapshot.

### Q067. Does using a CRDT guarantee that no edit is ever lost?

No. The convergence property assumes that relevant valid updates survive and eventually reach compatible replicas. A device can still lose an uncommitted edit, a database can fail, or an update can be rejected for exceeding limits. The journal, validation, recovery and acknowledgement layers are necessary because a mathematical merge model alone does not provide durable delivery or availability.

### Q068. How is the rich-text editor connected to Yjs?

The document uses a structured Yjs context integrated with ProseMirror rather than treating rich text as arbitrary string offsets. Updates can represent structural edits and formatting. Incoming data is validated before touching the live document context. This avoids the assumption that an insertion offset in a serialized representation always corresponds to the same meaningful rich-text location on another replica.

### Q069. What is a state vector?

A Yjs state vector summarizes how far a replica has seen the insertion histories associated with client identities. A peer can use it to compute missing update information. It is useful for resynchronization after disconnection, but it is not a full document hash and does not by itself describe every deletion. Our acknowledgement design explicitly accounts for that limitation.

### Q070. Why do state vectors need special treatment around deletions?

Two states can have the same insertion-clock summary even though their deletion knowledge differs. If the application used only equal state vectors to declare synchronization, it could falsely acknowledge a deletion that the receiver had not committed. The protocol therefore tracks update IDs and coverage barriers, and deletion-related tests check that old acknowledgements cannot silently stand in for newer changes.

### Q071. What is stored in the replica journal?

The replica database stores binary Yjs updates associated with a file and optional checkpoints containing combined state. These records support reconstruction when an editor reopens. The journal is local to an endpoint and does not depend on an intermediary holding the only copy. A relay's responsibility is different: the current prototype streams bytes without persisting document payloads.

### Q072. Why serialize journal writes through a promise chain?

Local editor changes and incoming updates can arrive while earlier persistence is pending. The replica's chained write sequence gives an explicit order for completing those operations and propagating failures. Its `flush()` drains the current tail, including work appended while an earlier tail was awaited. Otherwise, a save or acknowledgement could describe only part of the locally applied state.

### Q073. How does replay work after restarting an editor?

The replica reads its checkpoint and committed updates, validates and applies them to the Yjs context, and only then permits normal editing to continue. Replay must not be mistaken for a fresh user edit that creates an endless persistence loop. A corrupt or invalid replay is a visible recovery problem; silently starting with an empty document would hide potential data loss.

### Q074. What is compaction and why is it needed?

Without compaction, the journal would keep accumulating incremental records. After a bounded number of writes, the code combines state into a checkpoint and prunes the updates covered by it within the same transaction. It includes other committed tab records before pruning, which prevents one tab's incomplete view from erasing operations already stored by another tab.

### Q075. Is journal compaction the same as deleting old edits?

It replaces a representation of committed CRDT state with another representation covering the same information needed for replay. It must not discard concurrent committed updates that were absent from the current editor's in-memory view. Product version history is a separate concept; compacting the synchronization journal is not a promise to retain every individual human editing action as a navigable historical version.

### Q076. How does the protocol decide what to send after reconnecting?

A new session or resynchronization event starts a new synchronization generation and exchanges durable state vectors. Each endpoint computes update information missing from the peer and sends it through the authenticated document session. Pending transmission bookkeeping can be rebuilt from persistent CRDT state. The design does not require an in-memory outbound queue to survive every disconnection.

### Q077. Why use a generation counter in synchronization?

Asynchronous sends, reads and storage completions may finish after a session has disconnected or changed. The generation counter identifies the connection context to which a task belongs. Before publishing results or sending an acknowledgement, the code checks that the generation is still current. This prevents stale callbacks from marking a new session as synchronized or using obsolete connection state.

### Q078. What are the native document message kinds?

The browser protocol uses `vector`, `update` and `ack`, with a file identifier and encoded data. Updates include IDs used for acknowledgement tracking. The helper validates the selected document and allowed message kind before transmitting. This separation gives resynchronization summaries, actual CRDT changes and durability acknowledgements distinct meanings instead of overloading a generic “success” packet.

### Q079. When does the receiver send an acknowledgement?

After validating and applying the update, it waits for the replica persistence chain to flush. It sends an acknowledgement only if that operation succeeded and the session generation is still current. The meaning is a committed endpoint journal, not that a relay accepted data or that an operating-system socket buffer received it. Later UI acknowledgement checks also consider outstanding and pending local updates.

### Q080. What is the `coversEarlier` acknowledgement barrier?

It marks an update whose acknowledged coverage can retire preceding outstanding update records. During resynchronization, a delta derived against the peer's durable state can cover earlier changes; when tracking grows too large, a full-state update is used as a barrier. This is safer than discarding old tracking entries merely because their acknowledgements have not arrived, particularly for deletion-only changes.

### Q081. Are repeated updates a problem?

Yjs is designed to merge duplicate compatible update information idempotently. That helps when reconnect or retransmission repeats data, but it does not mean arbitrary replay is an authorization mechanism. TLS protects the stream against record tampering and unauthorized ciphertext replay, while the application still validates document identity, message bounds and acknowledgement state. Duplicate-tolerant CRDT behavior and cryptographic freshness solve different problems.

### Q082. What happens when an incoming update is invalid?

It is rejected instead of being blindly applied to the live editor. The Yjs validation path checks supported document structure and relevant bounds, and the synchronization layer reports an error without claiming acknowledgement. Rejecting malformed content may interrupt progress, which is preferable to corrupting the document silently. The user still needs a recovery route for their valid local committed state.

## 7. Windows Bluetooth and local bridge

### Q083. Which Bluetooth transport is actually implemented?

The Windows implementation uses native Classic Bluetooth RFCOMM sockets. It is not a Wi-Fi tunnel renamed Bluetooth, and it is not the Bluetooth SIG Mesh protocol. The browser communicates with its own loopback helper; document traffic between laptops uses the native radio path. The old bounded BLE framing module should not be confused with the current transport selected for the Windows preview.

### Q084. What is RFCOMM?

RFCOMM provides a stream-oriented communication model over Classic Bluetooth that applications can use somewhat like a connected byte stream. The current implementation places TLS and application framing above it. Similarity to a TCP programming model does not make the physical transport IP or Wi-Fi; platform-specific discovery, pairing, socket options and radio behavior still apply.

### Q085. Why must the devices be paired?

The Windows path enumerates OS-authenticated paired devices and requires an appropriate paired target before dialing. Pairing also supplies the operating-system Bluetooth security layer requested by the sockets. That relationship is not the complete document authorization: the receiver must additionally authenticate the intended document host through its certificate pin and invitation secret.

### Q086. What is an SDP service UUID?

A service UUID identifies the Bluetooth service being advertised or requested during service discovery. The document service and experimental relay service use different UUIDs so their protocols are not accidentally mixed. A UUID is an identifier, not a password. A device advertising a matching service must still pass the relevant pairing, admission and endpoint authentication checks.

### Q087. Why is the helper bound to loopback?

It is intended to serve the browser and control Bluetooth only for the local machine. Binding to a loopback IP avoids exposing its HTTP bridge as a general LAN service. The implementation also checks the Host header and request origin context. These are separate defenses because a local network address restriction alone does not prevent malicious browser content from attempting requests.

### Q088. What prevents any web page from controlling the helper?

The bridge rejects inappropriate origins and fetch-site contexts, validates loopback host usage and requires a generated native token for protected operations. The token is obtained through the same-origin bootstrap path. This reduces cross-origin abuse but does not protect against arbitrary malicious code already running in the trusted application origin or a fully compromised local computer.

### Q089. What HTTP operations does the native bridge expose?

Its narrow surface includes bootstrap, status, paired-device enumeration and event polling, plus commands to host, connect, stop and send validated document messages. It does not expose a general command shell or arbitrary filesystem access. Request methods, JSON shape, message size and one-command parsing are checked so the browser bridge is a small control interface rather than an unrestricted native capability.

### Q090. How does the browser receive native Bluetooth events?

The native bridge uses cursor-based event requests with bounded waiting rather than requiring the browser to own the Bluetooth socket directly. The helper maintains bounded event history and signals when the cursor no longer covers the retained events. A reset tells the document layer to resynchronize from durable state instead of assuming every intermediate notification is still available.

### Q091. Why is there length-prefixed framing above RFCOMM?

A byte stream does not inherently preserve application message boundaries. The native code prefixes each JSON packet with a four-byte big-endian length so the receiver knows how many bytes form one message. It rejects zero, oversized and truncated frames. The two-MiB outer frame bound is separate from the smaller validated document-update and initial-snapshot limits.

### Q092. What happens if a socket write sends only part of a frame?

The writer keeps sending the remaining bytes until the frame is complete or an error occurs. A zero-progress write becomes a short-write failure instead of causing an endless loop. On the receiving side, full reads are required for the header and body. These details matter because assuming one write equals one read would break even on an otherwise healthy stream.

### Q093. Why are there deadlines and cancellation paths?

An unresponsive or malicious peer can otherwise hold sockets and goroutines indefinitely. The helper uses bounded setup and communication deadlines and owns pending as well as established connections so Stop can interrupt them. Cancellation also prevents old connection attempts from publishing a connected state after a newer user action has replaced the session.

### Q094. What limits apply to a Windows sharing session?

The preview supports one selected document and one peer, with a source JSON snapshot up to 512 KiB and a replica/update bound of 1 MiB. The native outer frame has a 2 MiB maximum, and invitations/sessions are limited to 30 minutes. Those limits should be stated as current design constraints, not interpreted as measured throughput or radio range.

### Q095. Has the real Bluetooth hardware been tested at all?

Yes, the recorded single-laptop checks verified an available radio, paired-device handling, listener and service registration behavior, and real host start/stop with invitation export/import. That is more than a pure socket mock, but it is still not a completed two-physical-device document exchange. Hardware evidence must be described at the level that the test actually exercised.

### Q096. What is the next physical Bluetooth acceptance test?

Use two identified Windows laptops with Wi-Fi and internet disabled, exchange a real invitation, edit in both directions and verify endpoint journal acknowledgements and content convergence. Then test concurrent edits, disconnection, reconnect and restarts. Record device, OS, driver, artifact version and failure conditions. The Android relay trial adds another independent pair of physical links and lifecycle conditions.

## 8. Encryption, authentication and trust boundaries

### Q097. What does end-to-end encryption mean in this design?

The document TLS session is established between the actual document endpoints, while relays forward its encrypted byte stream without terminating that TLS layer. The intended document content is therefore not plaintext at a normal forwarding relay. This statement assumes uncompromised endpoints and correct authentication; it does not claim anonymity, invisible traffic metadata or immunity to every implementation vulnerability.

### Q098. Which encryption algorithm do you use?

The native document connection requires TLS 1.3 and uses Go's TLS implementation to negotiate an allowed TLS 1.3 cipher suite. We should not claim a single hardcoded record cipher merely from the certificate type or the word TLS. The session certificate uses an ECDSA P-256 identity, while record encryption and key establishment are separate parts of the protocol.

### Q099. Did you invent your own encryption?

No. The implementation relies on standard TLS primitives rather than inventing a new cipher or key exchange. Our engineering work is in how endpoint identity is distributed, how the document invitation is checked, how the stream is relayed and how durable acknowledgements are interpreted. Standard cryptography is necessary but still requires correct integration, implementation review and release-specific vulnerability assessment.

### Q100. What is inside a DBT1 invitation?

It encodes a 32-byte SHA-256 pin of the host's session certificate and a random 32-byte invitation secret, represented as a versioned URL-safe code. The certificate pin tells the receiver which endpoint identity to accept; the secret authorizes joining that host session. It is not a plaintext copy of the document or a TLS traffic-key export.

### Q101. Why is the session certificate self-signed?

The offline workflow cannot depend on a public certificate authority issuing a certificate for each nearby session. Instead, a trusted out-of-band invitation pins the exact certificate generated by the host. That changes the trust model: the user must get the authentic invitation to the intended receiver. A public CA is replaced by explicit pin distribution, not by an absence of identity checking.

### Q102. Why does the code set `InsecureSkipVerify`?

The name refers to bypassing the ordinary CA-chain and hostname verification path for this self-signed offline identity. The code supplies a `VerifyConnection` callback that checks the expected certificate pin in constant time. Removing that callback or accepting any self-signed certificate would be a serious flaw. The defensible explanation includes the replacement verification, rather than pretending the field is not present.

### Q103. Does the certificate pin authenticate the human owner?

It authenticates the session certificate whose pin was placed in the invitation. That only becomes meaningful as an owner identity if the invitation was distributed authentically to the intended person. The protocol does not establish a government identity or automatically prove who is holding an unlocked laptop. Human verification and invitation handling remain part of the trust boundary.

### Q104. Why require a secret if the certificate is already pinned?

The certificate pin helps the receiver reject a wrong or impersonating host. The separate invitation secret lets the host reject a client that has not been given session access before offering the document. These are opposite directions of trust. The current flow is bearer-invitation authorization, not mutual certificate-based human identity with an enterprise account directory.

### Q105. Can someone who steals the invitation join?

Possession of a valid invitation is an important authorization capability, so it must be treated as a secret. A person who also satisfies the relevant Bluetooth access conditions could attempt to join during its valid session. The UI therefore warns about sharing and expiry. Encryption cannot compensate for giving an access credential to an unintended person.

### Q106. Do the sender and receiver share a fixed document encryption key?

The DBT1 invitation carries a certificate pin and authentication secret, while TLS negotiates the traffic keys used by the connection. It should not be described as simply copying one fixed document key into the JSON file. Relays receive neither the endpoint invitation nor the negotiated TLS keys. An accurate answer distinguishes authentication credentials from the session's actual encryption key material.

### Q107. How is a man-in-the-middle rejected?

A relay or other intermediary presenting its own certificate does not match the pin in the receiver's authentic invitation. The handshake is therefore rejected before the document session is accepted. Synthetic tests exercise that behavior. If an attacker can replace the out-of-band invitation itself, the original identity assumption has already failed, so invitation distribution must also be protected.

### Q108. Can a relay alter the document secretly?

Changing protected TLS record bytes should cause authentication failure rather than producing an accepted altered application message. The lab tests ciphertext mutation and rejection, but that is limited implementation evidence rather than a proof of all possible attacks. A relay can still drop, delay or interrupt traffic. Integrity protection does not force a malicious forwarding node to deliver data.

### Q109. Does encryption hide the amount of traffic?

Not completely. A relay can observe adjacent devices, connection timing and the volume and sizes of data flowing through it. Even encrypted communication can reveal patterns, such as when users become active. Padding could reduce some inferences, but it introduces bandwidth and battery costs and would need separate design and measurement. We do not claim zero metadata leakage or anonymity.

### Q110. Are documents encrypted at rest?

The local workspace and exported JSON backups are not encrypted at rest by this application. Browser profile and device security therefore matter. A locked device or operating-system disk encryption can contribute protection, but that is not equivalent to an application-level encrypted database design. We should not use end-to-end transport encryption as an answer to a local-storage privacy question.

### Q111. Can the hosted server read stored document content?

Do not generalize the Bluetooth trust model to the hosted persistence mode. The inherited hosted application has file persistence APIs and storage backends; their saved document content and authentication model must be assessed separately from encrypted peer-transport frames. “The collaboration stream is encrypted” does not prove that every server-side snapshot, import, log or backup is opaque to the operator.

### Q112. How are replay attacks handled?

TLS authenticates records in the context of a connection, and recorded ciphertext is not a reusable application authorization token for a different session. The lab exercises duplication and substitution of previous-session ciphertext, while application generation and acknowledgement checks prevent stale asynchronous state from declaring a new session complete. Invitation reuse and future route-control replay need their own lifecycle and expiry policies.

### Q113. What security claim can you defend today?

We can point to explicit OS-paired links, pinned TLS endpoint authentication, invitation-secret checks, bounded frame validation, bridge access checks and recorded negative software tests. We can also show an APK that lacks Internet permission and does not request a document invitation. We cannot claim a completed independent audit, perfect secrecy of all metadata, secure compromised endpoints or production certification.

### Q114. What would production security review need to cover?

It would examine the threat model, invitation distribution and revocation, native bridge, TLS integration, parsers, Android permissions, lifecycle races, relay admission and resource limits. It would also assess logs, crash dumps, update authenticity, dependencies and device compromise assumptions. Findings need reproducible fixes and regression tests. Passing a short demo or using a standard cipher does not replace that review.

## 9. Android relays and cross-platform implementation

### Q115. What exactly does the Android application do?

The experimental Android app forwards a stream between two explicitly selected paired devices. It is not currently an Android document editor or a complete automatic mesh. The first intended physical route is a Windows receiver through a phone to a Windows document host. A second phone can extend a manually configured chain, subject to physical simultaneous-link and lifecycle validation.

### Q116. Why implement the Android relay in Java?

The prototype can use native Bluetooth sockets, Android foreground services and permission handling directly without embedding the office editor or a large additional framework. Java also allows the platform-independent admission and copy core to be tested on a JVM. That choice does not settle the eventual Android endpoint architecture; document editing on Android is still a separate implementation decision.

### Q117. What permissions does the APK request?

It requests legacy Bluetooth permissions on the older API range, Bluetooth connect access, notifications and the foreground-service permissions needed for a connected-device service. The artifact check found the expected six permissions and no Internet permission. It does not request location or contact access. Actual grant, revocation and OS-version behavior still require tests on the intended physical phones.

### Q118. Why is there a foreground notification?

Relaying is an ongoing activity that the phone's owner should be able to see and stop. The app starts an explicit foreground service with a Stop action rather than silently relying on a hidden background process. A notification is not a guarantee that Android will keep the process alive under every condition, and disabled notification access is handled as a setup problem.

### Q119. Can relay mode run when the app screen is not open?

The intended mechanism is the explicitly started native foreground service, so forwarding need not depend on keeping the activity visible. However, this has not been validated across the reported phones' screen-off, battery-saver and manufacturer-specific process management conditions. Force-stop, process death or a disabled radio can end the relay. We should never promise an inactive or unpowered phone will continue forwarding.

### Q120. What is the DRL1 code?

DRL1 is a separate admission credential for an experimental relay circuit, based on a random 32-byte token. It permits the selected incoming neighbor to open the phone's forwarding path. It is not the DBT1 document invitation and does not give the relay endpoint TLS keys. Separating those credentials lets the relay enforce access without being authorized to read the document.

### Q121. What happens during relay admission?

The incoming stream presents the `DRL1` magic followed by the token. The phone verifies the bounded header, the selected incoming device and bonded state, then establishes its configured outgoing connection. It returns the ready byte after that path is ready. Document TLS authentication still happens beyond the relay, so a ready relay does not imply a valid document session or saved payload.

### Q122. Why are relay neighbors selected manually?

A fixed route keeps the first prototype's trust and failure behavior understandable: each phone owner chooses the allowed incoming device and a specific outgoing target. It avoids advertising automatic route discovery before that subsystem exists. Dynamic routing would require authenticated discovery, expiry, loop prevention, fairness and malicious-node analysis, all of which are additional protocol work rather than a small UI enhancement.

### Q123. Can the incoming client tell the phone to connect to any target?

The current phone is configured by its owner with the allowed neighbor and outgoing device, rather than accepting arbitrary destination commands from the incoming client. That reduces the risk of turning a relay into a general Bluetooth proxy. It does not make relay access safe under every pairing configuration; resource exhaustion and compromised local software still belong in the threat model.

### Q124. What are the prototype's relay limits?

There is one active circuit per phone, with 16 KiB copy buffers in each direction and a shared 64 MiB circuit byte budget. Relay mode expires after 30 minutes, with 12-second setup and 30-second inactivity limits checked by a watchdog. These are safeguards for the experiment, not measured sustained throughput or production capacity figures.

### Q125. Why use one shared byte budget for both directions?

If each direction or thread enforced its own unsynchronized count, concurrent copying could exceed the intended resource bound. The relay core uses an atomic shared budget so both directions reserve from the same limit before forwarding a chunk. JVM tests exercise that concurrent accounting. The forwarded-byte counter is updated after a successful output operation and still does not mean a document commit occurred.

### Q126. Does the relay decrypt and re-encrypt each document chunk?

It does not terminate the document TLS session. It forwards opaque bytes while the actual document endpoints authenticate and exchange protected records. There can also be OS-level security on each paired radio link, but that is a separate layer. Calling every hop's link encryption “end-to-end encryption” would be incorrect if the relay were given plaintext between those links.

### Q127. How does a two-phone route get configured?

Configure the phone nearest the host first, with the host as its outgoing device. Configure the previous phone to use that phone as the next relay and provide its DRL1 code. The Windows receiver uses the first phone's relay code and still receives the host's DBT1 invitation directly. Adjacent devices must be paired and able to sustain the necessary physical links.

### Q128. Are Samsung A36 and OnePlus Nord officially supported?

They are the user's reported available test devices, not a certified support matrix. Exact variants, Android versions, firmware and simultaneous Bluetooth behavior need to be recorded during trials. The app displays model and Android/API information to help with that process. Building an APK with a minimum SDK does not prove every device above that API level behaves identically.

### Q129. What does a debug-signed APK prove?

It proves that the development artifact has a verifiable signature and can be identified by its recorded hash and application ID. It does not mean the artifact is production-signed, store-reviewed, penetration-tested or physically validated. The report identifies it explicitly as an experimental debug build. A release signing and update strategy remains part of production preparation.

### Q130. Why does restarting a relay require a new code?

The prototype creates a fresh admission token for the new relay session and does not silently restore the old one from persistent storage. The incoming Windows experiment must therefore be restarted or reconfigured with the current code. That is less convenient than automatic recovery, but it avoids pretending a stale credential still authorizes the new service instance. Improved credential lifecycle design is later work.

## 10. Failures, adversarial conditions and edge cases

### Q131. What happens when Bluetooth disconnects during editing?

The local document remains editable according to its local storage and recovery state. Shared updates are retained through the endpoint journal rather than relying on a connected relay queue. Reconnection starts resynchronization and only a valid receiving acknowledgement can restore the peer-acknowledged state. The physical behavior across actual range loss still needs the two-device acceptance trial.

### Q132. What if a relay deliberately drops every packet?

Encryption cannot force delivery. The circuit eventually fails or times out, while the endpoints retain their local committed work and do not claim successful synchronization. Dynamic alternate-route selection is not implemented in this fixed-route prototype. Detecting malicious routing behavior and choosing another path without creating new security problems is part of the later routing phase.

### Q133. What if a relay reorders bytes?

The current endpoint protocol expects a reliable ordered byte stream. A forwarding layer must preserve that property or close the circuit; it cannot arbitrarily shuffle TLS record bytes and expect the document layer to repair them. A future datagram transport would need its own ordering, retransmission and bounds design below the endpoint stream, or a different reviewed protocol above it.

### Q134. What if the connection is very slow?

The application should expose pending synchronization rather than claiming immediate delivery. Setup and inactivity deadlines bound resource use, so a sufficiently slow or interrupted path may fail instead of hanging indefinitely. Timeouts are therefore a tradeoff between usability and protection. We need field latency and throughput measurements before selecting production values for long multi-hop paths.

### Q135. What if the document becomes too large while editing?

The nearby replica enforces its current bounds and reports a recoverable error rather than sending unbounded data or falsely acknowledging it. The user should retain or download a recovery copy. The ordinary workspace's larger document limit does not make the document eligible for Bluetooth sharing. Product messaging must show which limit applies at the specific operation being attempted.

### Q136. What if two devices create unrelated documents with the same ID?

The receiver checks whether an existing local record with that identifier is an appropriate shared replica. A conflicting ordinary, trashed or different-type record is rejected rather than overwritten. Random UUIDs make accidental collisions unlikely, but validation is still necessary because received identifiers are untrusted input. Probability is not a substitute for explicit collision behavior.

### Q137. What if an old editor saves after the document is converted to a replica?

The local workspace rejects a non-replica snapshot write to a record that is now managed as a shared replica. This prevents an older tab from replacing journal-based work with a stale whole-document snapshot. The user receives recovery guidance and should reopen the current editor. Migration correctness needs this backward interaction check, not only a successful first conversion.

### Q138. What if the peer's storage is full?

Applying an update in memory is not enough to acknowledge it. If the destination journal flush fails, the protocol reports the error and does not send a successful durability acknowledgement. The sender keeps its local committed state for recovery and resynchronization. This is why a packet-receipt counter or a radio-level acknowledgement cannot replace application-level persistence confirmation.

### Q139. What if a received JSON message contains extra fields or multiple objects?

The native HTTP command decoder disallows unknown fields and checks that the request contains one complete command rather than trailing JSON. It also enforces content type and a body-size bound. These checks make the bridge's intended request grammar explicit. Other parsers have their own validation boundaries; strict command parsing should not be generalized to every unrelated import format without inspecting it.

### Q140. What if the invitation expires while the host is still open?

The native session has a bounded lifetime and reports expiry. The host must start sharing again to create a current invitation, and the receiver must use that new credential. The interface should not offer an inactive invitation as though it still worked. Expiry is tied to the application's session lifecycle, not merely the self-signed certificate's separate validity interval.

### Q141. What if an old native event arrives after reconnecting?

The bridge and synchronization code associate events and asynchronous work with session or generation state. Messages for a different selected document or obsolete connection are not supposed to advance the current session. Tests exercise cancellation and stale-state cases. This is necessary because asynchronous delivery can outlive the UI action that originally started it, even when the underlying byte stream is ordered.

### Q142. What if a malicious peer sends a huge length header?

The native framing reader checks the length before allocating the full body and rejects values outside its bound. The browser update path also checks encoded and decoded update sizes. Defense in depth matters because a request can pass one layer's grammar while being too costly or invalid for the next. Resource limits are part of security as well as performance.

### Q143. What happens if Android revokes Bluetooth permission mid-session?

Native calls can throw a security exception even after an earlier permission check succeeded. The prototype catches permission-related failures, closes owned sockets and reports a stopped or failed link rather than treating the previous check as permanent permission. Lint and code review cover the explicit handling; testing real revocation during forwarding remains a physical Android lifecycle gate.

### Q144. Can a stop action leave a hidden socket running?

The design owns listener, pending and established resources so stopping can close them, cancel work and prevent stale connected states. The Android review also corrected ownership of accepted sockets before permission-sensitive inspection. Software checks reduce the risk but are not a proof of all OS race schedules. Repeated stop/start, process-death and physical radio-transition tests remain necessary.

## 11. Testing and evidence quality

### Q145. What tests have actually passed?

The recorded stable package report lists 19 Chrome scenarios and real single-radio host start/stop plus invitation export/import. Earlier focused verification recorded 133 tests across 13 files. The relay lab has 23 scenarios repeated ten times; the prototype verifier adds 108 JVM checks, nine tagged Go scenarios repeated three times, zero Android lint issues and an isolated Windows package smoke test.

### Q146. Why not combine all those counts into one impressive test total?

They measure different things and some runs repeat the same scenario. Adding them into one unqualified number would obscure the difference between a distinct test, a repeated execution, a static check and a physical observation. We report each layer separately with its transport assumptions. A hundred simulated hops do not become a hundred verified Bluetooth links by arithmetic.

### Q147. What do the Chrome scenarios demonstrate?

They exercise actual browser behavior such as local creation, saved-state recovery, backup restoration, stale tabs, invitation handling and offline reload or restart. Some collaboration scenarios replace only the native transport with a test double so real editor and persistence code can be checked deterministically. That proves browser/protocol behavior under the tested conditions, not physical radio performance between laptops.

### Q148. What is fault injection?

It deliberately introduces failures such as unavailable IndexedDB, write errors, missing documents or rejected imports so recovery behavior can be tested. Waiting for those failures to occur naturally would make coverage slow and inconsistent. The limitation is that a synthetic fault approximates a class of failures; it does not prove that every real disk, browser or operating-system failure behaves identically.

### Q149. What do the relay captures prove?

The lab captures synthetic streams in memory at each relay and checks that selected document, invitation and payload markers are absent in both directions. This supports the claim that the tested implementation forwards protected endpoint traffic rather than those plaintext markers. It is not a cryptographic proof, an anonymity analysis or evidence that production crash dumps and all logging paths have been audited.

### Q150. Have you tested a real Android phone forwarding a document?

No physical Android relay exchange is recorded as passed in the available evidence. The APK compiles, passes lint, has a verified debug signature and permission set, and its platform-independent core has JVM tests. Those are valuable preparation steps, but simultaneous radio links, power management, user permissions and endpoint delivery must still be exercised on the actual phones.

### Q151. Why is the Go race-detector gate still open?

The attempted race build failed because the installed local MinGW compiler cannot compile the required Windows amd64 runtime. A normal passing Go test run is not a substitute for a race-detector pass. The report records this toolchain limitation explicitly. A compatible 64-bit compiler and realistic concurrent workloads are needed before that specific check can be marked passed.

### Q152. How would you make the tests reproducible for judges?

Provide the source commit, lockfiles, toolchain requirements, test command and expected report, with no private credentials or personal documents. There is a current reproducibility gap: the broad `localfirst` ignore rule accidentally excludes the local Java package directory, and some build/verifier helpers live outside the pushed repository. Before claiming a reproducible Android source release, correct that rule, commit the missing source and make the helpers portable. Label each transport as memory, loopback, browser stub or real Bluetooth, and record the exact hardware for field trials.

### Q153. Why test the actual packaged executable?

Unit tests cannot reveal every packaging failure, such as missing assets, a stale frontend version, incorrect worker behavior or an unexpected runtime dependency. The package check runs the executable with a restricted runtime environment, opens a fresh browser profile and checks relevant behavior. It complements source tests; it does not convert a local packaging smoke test into proof of multi-device interoperability.

### Q154. How do you test an application update without losing work?

The upgrade verifier starts from an older cached application, creates saved work, switches to the current server and reproduces the stale interface. It then opens the special launcher and checks the new controls, the unchanged old editor and a subsequent offline reload. That tests a concrete earlier failure while preserving the distinction between asset cache activation and personal document storage.

### Q155. What should be in a physical field-test report?

Record device models, exact OS and driver versions, artifact hashes, route and adjacent distances, radio settings, obstacles and start/end times. Include exact-content or convergence checks, endpoint commit acknowledgements, latency and throughput measurements, disconnects and recovery outcomes. Avoid publishing document content, invitation secrets or private device identifiers. A map and byte counter alone do not establish durable collaboration.

### Q156. How do you decide that a feature is production ready?

Define supported devices, correctness, recovery, security and performance gates before declaring success. Production readiness requires release signing, update and rollback behavior, vulnerability review, operational support and hardware evidence in addition to passing software tests. The current relay experiment has explicit open gates. We can demonstrate progress without relabelling those remaining risks as already solved.

## 12. Performance, scale and range

### Q157. What is the maximum Bluetooth range of the project?

It has not been measured as a supported product limit. Bluetooth range depends on the actual radios, physical layer, power, antennas, obstacles and interference, as described by the [Bluetooth SIG](https://www.bluetooth.com/learn-about-bluetooth/key-attributes/range/). Our current software tests do not provide a metres-per-hop number. The 800 m to 1 km figures are targets for later trials.

### Q158. How many relays are needed for 800 metres?

That cannot be answered without measuring reliable adjacent-link spacing in the intended environment. As arithmetic only, 800 m with usable 40 m spacing would require at least 20 links and 19 intermediate nodes on a straight path. That is not a recommendation or a measured laptop range, and redundant coverage, obstacles and route shape can require more nodes.

### Q159. Is an 800-metre route the same as an 800-metre radius?

No. A chain connecting two endpoints along one route establishes neither all directions nor every point within a circle. Radius coverage requires a sufficiently connected distribution of nodes across the area and trials that identify gaps. This distinction changes both hardware cost and deployment planning, so the project should not use a successful linear route to advertise circular area coverage.

### Q160. Does adding relays always improve performance?

Relays can make a previously unreachable endpoint reachable, but each hop introduces scheduling, radio contention, failure opportunities and energy use. A longer path may have worse latency and lower useful throughput. The result depends on actual hardware and traffic. That is why hop-count tests are a protocol exercise while performance targets must be established through measured field workloads.

### Q161. Can the current release support many simultaneous collaborators?

The Windows Bluetooth preview is explicitly limited to one selected document and one peer, and the Android relay prototype permits one active circuit per phone. The inherited online collaboration stack has different capabilities and constraints. We should not borrow a scalable architecture diagram from another mode as evidence that this particular radio preview already supports a classroom full of concurrent editors.

### Q162. What performance metrics would you measure first?

Measure local typing responsiveness and save-completion latency separately from end-to-end update acknowledgement latency. Add connection setup time, reconnect time, throughput, memory growth, CPU use and phone battery drain. Report distributions such as p50, p95 and p99 under a named workload and hardware setup. Averages alone can hide the occasional long stall that makes collaborative editing frustrating.

### Q163. Is the 25-millisecond outgoing timer a latency guarantee?

No. It is a coalescing delay before attempting to flush pending persisted updates. Actual completion also includes storage, scheduling, serialization, Bluetooth transport, peer validation, receiving storage and acknowledgement. Those stages can dominate the timer. We should explain configuration constants as design choices and then measure the user-visible latency rather than presenting the smallest timer as a benchmark.

### Q164. Why send periodic state-vector resynchronization?

It provides another opportunity to discover missing durable update information after connection changes or missed application-level progress. The code schedules it every eight seconds while the selected document is connected. That interval is not a maximum convergence guarantee and does not compensate for a permanently unavailable route. A healthy path and successful endpoint persistence remain necessary for acknowledged synchronization.

### Q165. Does a 16-KiB buffer mean the relay uses only 32 KiB of memory?

No. Those are the explicit copy buffers for two directions, not the whole process footprint. The Android runtime, threads, Bluetooth stack, sockets, UI and other objects also use memory. The byte budget bounds traffic permitted for a circuit rather than total retained memory. Real device profiling is necessary before making an overall memory or low-end-device suitability claim.

### Q166. How would you avoid a relay being overwhelmed?

The prototype starts with one circuit, bounded buffers, shared byte limits, admission checks and setup/idle/session timeouts. A more general network also needs global admission limits, fairness, backpressure, routing-message limits and protection against connection floods. Increasing concurrency before those controls and measurements exist could turn an availability feature into a resource-exhaustion problem on participating phones.

### Q167. Why not use Wi-Fi for higher bandwidth?

Wi-Fi-based local transport can be a valid alternative and should be evaluated against the actual requirement. The current effort explores Bluetooth-only nearby communication, which has different access and power constraints. We should not pretend Bluetooth is always the best transport. If users prioritize large files, throughput or fixed-site coverage, a different or explicitly selectable transport may be the better design.

### Q168. Would dedicated radio hardware solve the range problem?

It could change the available link budget, deployment control and supported physical layers, but it would also change cost, installation and interoperability. We have not validated or recommended a particular hardware product. The current reported test setup uses two laptops and two phones. Any dedicated-radio extension would need its own transport, security and field-test evidence rather than inheriting the existing range target as a guarantee.

## 13. Build, deployment and operations

### Q169. What does an end user need to install on Windows?

For the packaged offline app, the user extracts the complete Windows package and runs its launcher, keeping the bundled web assets beside the executable. Node.js and Go are development requirements rather than runtime requirements for that package. Bluetooth sharing additionally requires an available supported radio and pairing. A clean disconnected-machine installation remains a separate acceptance scenario from running on the development laptop.

### Q170. What does the Android user install?

The current local artifact is the separate experimental relay APK, identified by its application ID and hash. It is not the main Windows editor packaged for Android. The user must grant the relevant permissions, select paired neighbors and explicitly start relay mode. The locally built APK is not yet a complete reproducible public source release because Java sources were accidentally ignored; production distribution, signing and update trust also remain unfinished.

### Q171. How are the stable and experimental applications isolated?

The known working offline app uses port 8765, while the experimental Windows receiver uses 8768 and a distinct artifact directory and banner. The different origins separate their browser workspaces. Go build tags exclude experimental connector code from the normal build. This isolation lets testing proceed without silently changing the runtime behavior or document storage context of the user's working release.

### Q172. How do you identify exactly which build is running?

The local health response reports frontend cache and native executable versions, derived from build artifacts. The launcher compares those values with its package metadata instead of treating any responding server as current. For evaluation, also record the source commit and APK or executable hashes. A version number identifies an artifact; it does not by itself prove the feature's hardware behavior or security quality.

### Q173. What role do Vercel and Railway play?

The repository includes a cloud deployment route with a frontend preparation step and a Go server deployment configuration. Those are separate from the offline Windows app's local asset server and Bluetooth helper. A cloud deployment URL is useful for a hosted mode but is not a dependency of the implemented offline document workflow. Deployment presence also does not certify cloud authentication, availability or cost.

### Q174. Are cloud credentials stored in the project source?

The deployment configuration is designed to obtain relevant secrets through environment or local configuration rather than hardcoding real credentials into publishable source. The main-repository publish review excluded local runtime data and credentials. That review is not a perpetual guarantee about every future commit. Secret scanning, least privilege and deployment-specific configuration remain necessary operational practices.

### Q175. Why were SDK files not committed to Git?

Downloaded toolchains, caches and generated application packages are not the project's source. Trying to stage them caused excessive line-ending warnings and a Windows path-length failure, so local exclusions now keep those directories out of staging. Source exclusion needs equal care: an existing broad `localfirst` ignore rule also matched the Java package name, which is an accidental gap to fix. Reproducible setup should version the actual source and tool definitions while downloading SDKs by documented versions and checksums.

### Q176. Why does the repository contain both hosted and offline code?

The project extends an existing self-hostable office suite, so its original backend and online collaboration features remain useful context and functionality. The offline build selects a different persistence and transport path without requiring all inherited code to be deleted. Documentation must make the active mode explicit; otherwise, features from one deployment can easily be misrepresented as guarantees of another.

### Q177. How should updates preserve user documents?

Keep the same browser origin and profile, update application assets separately from document databases, and avoid reloading unsaved editors automatically. The launcher and service-worker update path address a specific stale-cache problem. Future schema changes require explicit migration and rollback testing. Replacing an executable or clearing a cache should never be explained to users as permission to clear their personal browser data.

### Q178. What operational work remains before release?

Release signing, update authenticity, rollback, clean installation, conflicting ports, supported device matrices and privacy-respecting diagnostics need complete validation. Native and Android dependency/toolchain review also remains important. The current debug and preview artifacts can support controlled experiments, but deployment convenience is not the same as a supported production service with recovery procedures and maintained security updates.

## 14. USP, alternatives and differentiation

### Q179. What is your defensible USP?

The strongest candidate is the combination of an offline document workspace, explicit local durability and recovery, endpoint-authenticated Bluetooth collaboration, and an experimental relay path that does not require relays to receive document invitations. Each component has precedents, so we should present the specific integrated workflow and evidence rather than claim that offline editing, CRDTs or encrypted Bluetooth are inventions unique to this project.

### Q180. Why would a user choose this instead of Google Docs?

For a user whose requirement is account-free local ownership and a Bluetooth-only collaboration path, this architecture explores a different workflow from a cloud-first office service. Google Docs also has offline capabilities, so claiming that it cannot work offline would be inaccurate. The honest comparison concerns installation, collaboration transport, trust and validated constraints, not a blanket statement that one product has every advantage.

### Q181. How is it different from desktop Word or LibreOffice?

Desktop office tools already provide strong local editing and mature document features. Our additional focus is the nearby authenticated sharing path, durable replicated document state and visible distinction between a local save and peer commit. We should acknowledge their compatibility and usability strengths. A judge may reasonably prefer an existing tool if the nearby collaboration requirement is not important to the target user.

### Q182. How is it different from ONLYOFFICE or Collabora?

Those are established collaborative office alternatives with their own deployment models and product-specific security options. Our demonstrated offline path places local storage on the endpoint and uses a native Bluetooth document session rather than assuming a particular hosted document collaboration service. Exact edition and configuration matter when comparing encryption or offline features; we should not reduce a competitor's complete product family to one simplified deployment.

### Q183. How is it different from CryptPad?

CryptPad is a relevant privacy-focused collaborative alternative, so encrypted collaboration alone is not a sufficient uniqueness claim. The project's proposed distinction is the bundled local workspace and native nearby/relay workflow under connectivity constraints. The comparison should also recognize that a mature privacy product may have stronger operational and security experience. We need evaluated user benefits, not merely a different implementation language or protocol.

### Q184. Is this just another file-transfer application?

A file-transfer workflow can move a completed document snapshot, but it does not automatically merge concurrent rich-text edits or distinguish destination journal commits for a shared CRDT state. Our shared-document protocol aims at that ongoing collaboration behavior. Transfer tools remain useful for distributing the installer, backups or invitations, and may be sufficient when users only need to exchange completed files.

### Q185. Why not just use Syncthing?

File synchronization can be very useful, but synchronizing files is a different level of abstraction from a structured collaborative editor. A file-sync tool does not automatically supply this editor's schema validation, CRDT integration, draft recovery and peer-acknowledgement semantics. We should still acknowledge that users with ordinary file workflows may prefer a mature sync tool instead of adopting a new document application.

### Q186. What about Bluetooth messaging or mesh applications?

They are relevant alternatives for communication without normal internet service, and they show that offline relaying is not a new category invented here. Our proposed application is durable rich-text document collaboration rather than only exchanging messages. Their routing, security and platform capabilities must be compared from current official documentation and tested configurations. We should not infer feature gaps from their names or marketing descriptions.

### Q187. Can you claim this is the first such project?

No systematic prior-art study in this work establishes a worldwide first. The code also extends an existing open-source suite and uses established editor, synchronization and cryptographic libraries. A more defensible statement is that this version integrates and tests a particular offline durability and nearby-sharing workflow. Novelty claims should be narrower than “nobody has ever combined these technologies.”

### Q188. What would prove that your difference matters to users?

Run the same realistic outage-and-collaboration task with target users across suitable existing tools and this prototype. Measure completion, lost work, setup errors, recovery success, acknowledgement understanding and participant effort, not just technical packet delivery. For relays, include the burden of installing, pairing and powering intermediate devices. A technically different transport is not automatically a product advantage.

## 15. Ownership, business and project responsibility

### Q189. Did you build the entire office suite from scratch?

No. This repository extends the original open-source Diwan codebase, with a known upstream baseline and retained history. The contribution should be explained through the actual offline workspace, safety fixes, native nearby transport, invitation/update improvements, relay prototype and tests added or changed here. Libraries and upstream authors should be credited explicitly instead of presenting the inherited editor and backend as entirely original work.

### Q190. What licensing responsibilities follow from that?

The repository identifies an MIT-or-Apache-2.0 licensing model and contains license and third-party notice material. We need to preserve applicable notices and review the actual licenses of redistributed dependencies and artifacts. Open source permits many uses but does not mean every attribution or distribution obligation disappears. Commercial distribution and branding questions need a release-specific review rather than an unsupported blanket legal claim.

### Q191. What is the business model?

A business model has not been validated by the available engineering evidence. Possible hypotheses include supported deployment, training or managed institutional workflows, but each requires customer interviews, cost analysis and willingness-to-pay testing. We should not invent revenue, customers or grants. First demonstrate that the workflow is valuable enough to justify its installation and hardware participation costs.

### Q192. Is this cheaper than existing solutions?

No measured total-cost comparison has been completed. Local and open-source operation can change licensing or hosting costs, but support, deployment, device power, updates, backup and maintenance still cost time or money. A dense relay deployment may also require many participating devices. Cost claims should compare a defined use case and include those operational requirements rather than only the absence of a cloud subscription.

### Q193. What is the biggest project risk?

For the longer-range concept, the biggest immediate risk is turning a correct stream-relaying prototype into a reliable physical network on ordinary phones and laptops. Simultaneous links, Android lifecycle, placement and user participation can prevent a usable route even when encryption and merge logic work. Security hardening and durable recovery are equally important release risks that a distance-only demonstration would not resolve.

### Q194. What would you do next with more time or funding?

Complete a controlled Windows–Android–Windows physical exchange first, followed by a two-phone fixed chain and recovery scenarios on recorded hardware. Then measure energy, latency and range before deciding whether dynamic routing or a different transport is justified. In parallel, close the race-toolchain and independent security-review gaps. Expanding features should follow evidence instead of making the architecture broader before its essential path is reliable.

## 16. Expert traps and difficult follow-ups

### Q195. If the system is end-to-end encrypted, why can a relay still identify adjacent devices?

End-to-end encryption protects the document session's content and integrity, not every fact about its physical transmission. A relay must interact with its neighbors and can observe when and how much data it forwards. Hiding network participation and traffic patterns would require additional privacy mechanisms and a separate threat model. We therefore do not claim that transport encryption makes the network invisible or anonymous.

### Q196. If your state vectors match, why is that not sufficient evidence of synchronization?

A state vector summarizes insertion progress, while deletion knowledge can differ without changing that summary in the same way. The application therefore also tracks authenticated update IDs, pending writes and acknowledgement coverage barriers. A judge can inspect the deletion-related tests and `coversEarlier` logic. The right answer is that document-state convergence and durable receipt require more evidence than a convenient summary comparison.

### Q197. Can you guarantee availability, consistency and partition tolerance all at once?

We should not answer by treating a slogan as a feature checklist. During a partition, local replicas can keep accepting compatible local edits and later converge when updates survive and communication resumes; they do not provide a single instantaneously consistent global view. Durability and authorization are separate properties. The product must show that state honestly rather than calling disconnected replicas synchronously consistent.

### Q198. What happens if the receiving peer lies about committing an update?

The acknowledgement is authenticated as coming from the endpoint session, but transport cryptography does not prove the remote software executed a durable storage operation honestly. Our implementation sends acknowledgements after its journal flush; a malicious modified endpoint can violate that behavior. The trust model therefore includes endpoint software integrity. Trusted hardware attestation or stronger remote-proof schemes would be different, unimplemented requirements.

### Q199. Does passing 230 relay executions prove the design is secure and can reach a kilometre?

No. Those executions repeat 23 distinct synthetic relay scenarios under controlled memory-stream conditions. They help detect specific protocol regressions, but they do not measure radio propagation, Android power management, hidden implementation races or all cryptographic threats. The report explicitly leaves physical range and production/security certification false. A strong presentation values that scope precision more than an inflated test count.

### Q200. Why should judges value the project if so many production gates remain open?

Because useful engineering progress can be evaluated before a production launch, provided its boundaries are clear. The project demonstrates concrete offline storage and recovery behavior, a native authenticated sharing implementation, an isolated relay prototype and reproducible software evidence. Its next steps are specific and falsifiable. The credible claim is a working foundation with a disciplined path to validation, rather than a promise that every difficult problem is already solved.

## Evidence and source map

These links identify the main implementation boundaries behind the answers. Some older repository documents describe an earlier milestone; where they disagree with current source or a newer verification report, use the narrower current evidence.

| Topic | Primary project source |
| --- | --- |
| Scope, upstream attribution and repository history | [Project README](../../README.md), [upstream Diwan](https://github.com/vul-os/diwan), source reference `d7e9135` |
| Offline build and service-worker behavior | [Offline build generator](../../scripts/build-offline.mjs), [offline mode flag](../../web/src/lib/offline/mode.ts), [native launcher](../../cmd/localfirst-offline/launch.js) |
| Local file schema, revision validation and backup limits | [Workspace storage](../../web/src/lib/offline/workspace.ts), [local API adapter](../../web/src/lib/offline/localApi.ts) |
| Draft tokens and save generations | [Draft store](../../web/src/lib/draftStore.ts), [file state/store](../../web/src/store/filesStore.ts) |
| Journal, checkpoint replay and atomic compaction | [Local replica](../../web/src/lib/nearby/replica.ts) |
| Update IDs, generations, vectors and durability acknowledgements | [Document synchronization](../../web/src/lib/nearby/documentSync.ts), [synchronization tests](../../web/src/lib/nearby/documentSync.test.ts) |
| Native bridge and access checks | [Browser native bridge](../../web/src/lib/nearby/nativeBridge.ts), [Go HTTP bridge](../../internal/nearby/http.go) |
| TLS identity, invitation secret and native packet framing | [TLS/framing implementation](../../internal/nearby/secure.go), [native session hub](../../internal/nearby/hub.go) |
| Windows socket transport | [RFCOMM implementation](../../internal/nearby/bluetooth_windows.go), [Windows guide](../WINDOWS-BLUETOOTH.md) |
| Invitation file validation | [Invitation parser](../../web/src/lib/nearby/invitation.ts), [parser tests](../../web/src/lib/nearby/invitation.test.ts) |
| Android permissions and relay-only scope | [Android manifest](../../experiments/android-relay/app/src/main/AndroidManifest.xml), [experiment guide](../../experiments/android-relay/README.md) |
| Android admission, byte budgets and lifecycle | [Relay core](../../experiments/android-relay/app/src/main/java/org/diwan/relay/experimental/RelayCore.java), [relay service](../../experiments/android-relay/app/src/main/java/org/diwan/relay/experimental/RelayService.java) |
| Synthetic relay and endpoint trust tests | [Relay lab](../../internal/nearby/relay_lab_test.go), [tagged relay tests](../../internal/nearby/relay_experiment_test.go) |
| Open gates and measured-versus-planned distinction | [Relay phase plan](../BLUETOOTH-RELAY-PHASES.md), [scenario register](../BLUETOOTH-RELAY-SCENARIOS.json) |

**Public-source completeness note:** the Android Java links above point to files present in the local working tree. At the documented commit `d7e9135`, the root ignore pattern `localfirst` also matched the Java package directory, so the Java implementation and core tests were not included in the pushed source. Several Windows/Android build and verification helpers remain outside the nested repository too. The locally built APK and software reports are real evidence, but a clean-clone Android rebuild is not yet a passed claim. Correct the ignore scope, commit the missing implementation and make build helpers portable before presenting the Android source release as reproducible.

The workspace-local evidence files are `Diwan-offline-package-verification.json`, `Diwan-offline-upgrade-verification.json`, `Diwan-relay-phase1-verification.json` and `Diwan-relay-experiment-verification.json` in the parent workspace. They are development reports, not independent certificates, and are not automatically part of the public source repository. The package report records 19 Chrome scenarios; earlier audit prose mentioning 18 is historical. The prototype report records 108 JVM checks, nine tagged Go leaf scenarios repeated three times, zero lint issues, debug-signature verification and isolated Windows smoke checks. Its physical-relay, Android-lifecycle, range and production fields remain unverified.

For external comparison facts, use the primary sources and dated comparison notes in the companion project documentation. Do not memorize unsupported competitor absolutes such as “Google Docs has no offline mode,” “all other products expose plaintext,” or “Bluetooth mesh is our invention.”
