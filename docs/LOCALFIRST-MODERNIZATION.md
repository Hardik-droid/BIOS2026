# LocalFirst interface and compatibility

LocalFirst is an offline-first productivity workspace built on the existing React, TypeScript, Zustand, Go and editor engines. The modern interface uses locally bundled Inter, Lucide icons and shared light/dark semantic tokens. It adds no mandatory cloud account, remote font request or animation dependency.

## Interface

- The responsive workspace shell has an expanded sidebar, icon rail and keyboard-accessible mobile drawer. Its file views use real favorites, trash, shared records and local availability rather than simulated content.
- The dashboard provides real creation/import, search, type filters, sorting, list/grid views and file actions. Ctrl/Cmd+K opens the shared keyboard search palette.
- Documents retain Tiptap, autosave, recovery, Yjs and Bluetooth synchronization. The interface adds grouped formatting controls, title editing, favorite selection, focus mode, zoom and real document statistics. Page counts use the existing pagination model, not a guessed word-to-page conversion.
- Spreadsheets, presentations, whiteboards and PDF tools retain their existing engines and controls inside consistent editor chrome.
- Settings organize appearance, editor preferences, storage, backup/restore, peer connections, notifications, shortcuts, privacy and product information. Unsupported offline cloud operations remain unavailable.
- A local save is separate from a peer connection and from an acknowledged synchronized replica. The interface does not report a disconnected or solo session as live collaboration.

## Safe compatibility

Product labels, titles, manifests, favicons, generated downloads and new settings use LocalFirst. A small, explicit set of identifiers remains compatible:

1. **Documents and journals:** physical IndexedDB names are retained through `web/src/lib/brandCompatibility.ts`. Renaming or copying a live database could strand saved work or race older editor tabs. The same origin, port and browser profile remain essential.
2. **Preferences:** old branded preferences are copied into the new keys before React mounts, without deleting the originals or overwriting an explicit new choice. Editor preferences retain their previous fallback keys.
3. **Backups and invitations:** new JSON exports use LocalFirst formats and filenames. Importers accept both the new formats and the original version-one files. DBT1/DRL1 protocol identifiers and certificate-pin bytes remain unchanged.
4. **Cryptographic domains:** existing room key derivation labels, encrypted-room AAD, grid engine identifiers, Yjs metadata names and cross-tab channels retain their exact bytes. These are protocol contracts, not visible branding.
5. **Native helper:** the new helper and launcher display LocalFirst. Old metadata and native-token headers have read aliases so an upgrade can recognize a previous installation.
6. **Server configuration:** new `LOCALFIRST_*` environment settings take precedence. Legacy settings remain accepted by the environment compatibility helper; changing the display name does not rotate an existing JWT secret or modify a credential database.
7. **Android experiment:** the installed application's package identity is retained for upgrade compatibility. Its visible labels use LocalFirst. It remains an experimental relay, separate from direct Windows short-code pairing.
8. **Attribution:** original source URLs, commit history and legal notices remain accurate. Rebranding does not transfer authorship of inherited engines or remove their licenses.

The four-digit connection flow still requires trusted Windows Bluetooth pairing and explicit host approval. It does not make the four digits a traffic-encryption key. Physical two-laptop operation and Android relay/range validation remain separate acceptance tasks; interface tests cannot establish radio range.

## Verification

Run the frontend type check, focused storage/backup/invitation/replica tests, the offline browser suite, Go native/configuration tests and both web builds. The browser suite includes old-storage opening, local saves, recovery, backup restore, Bluetooth transport stubs, responsive navigation and branding checks. Inspect the packaged launcher on a separate loopback test port before replacing a running instance.

Generated packages, browser reports, screenshots and PDF exports remain outside the source history. Existing saved data is never cleared as part of an interface update.

### Verified release — 1 November 2026

- **32/32 Chrome acceptance scenarios passed**, with no failures, skips or flaky results. This includes real spreadsheet cell editing and reload, slide text editing and reload, whiteboard drawing and reload, PDF rendering/page navigation, and document zoom/full-window focus.
- The engine scenarios recorded no external or cloud-document API requests in offline mode. Whiteboard fonts, including the SDK's fallback URLs, now resolve locally.
- TypeScript checks, focused storage/backup/invitation/compatibility tests, pagination tests and spreadsheet normalization tests passed. Go configuration, environment compatibility, native Bluetooth, offline command, relay-tagged and monitoring-alias tests passed.
- The packaged native helper generated a real four-digit code on the development radio, exported/imported its full invitation, and stopped cleanly. This is one-radio evidence, not a physical two-laptop exchange.
- The upgrade check retained an existing editor, its saved document, old cached assets and an offline reload while activating the new version.
- Hosted login and document create/save/reload checks passed. The final deployment retained the five original cloud document IDs and serves the final frontend and local whiteboard font files.

Canonical local evidence: `web/test-results/offline-report.json`, plus the existing package, upgrade and published verification reports in the parent workspace. The final local package uses cache version `10135d6e2ff4f92f` and native version `45ff9836e469a80a`.

### Main modified areas

| Area | Source |
| --- | --- |
| Workspace shell, dashboard and settings | `web/src/components/Layout.tsx`, `Home.tsx`, `AppHome.tsx`, `Settings.tsx`, `SearchCommandPalette.tsx` |
| Shared visual system | `web/src/design/tokens.css`, `web/src/index.css`, `web/src/components/ui/`, `web/src/components/editor/` |
| Editor interfaces and spreadsheet persistence fix | `web/src/apps/docs/`, `sheets/`, `slides/`, `whiteboard/`, `pdf/` |
| Data compatibility | `web/src/lib/brandCompatibility.ts`, workspace/backup and invitation importers |
| Offline assets and installers | `web/src/main.tsx`, `web/vite.config.js`, `scripts/build-offline.mjs`, `scripts/package-offline.mjs`, `cmd/localfirst-offline/` |
| Product identity and deployment compatibility | `brand/`, web manifests/icons/metadata, Go module imports, `internal/brand/`, native headers, metrics aliases and deployment entrypoint |

The existing hosted address is intentionally retained for bookmarks and sessions. Physical Bluetooth exchange, Android relay/range testing and a full external accessibility audit remain separate validation tasks; this release does not claim those as completed.
