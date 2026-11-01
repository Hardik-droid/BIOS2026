# Bluetooth invitation import failure — 1 November 2026

The reported second-laptop error occurs during local invitation-file validation, before any RFCOMM connection is attempted. It is not evidence of a radio failure. The screenshot shows a working local bridge, local radio and paired-host selection, an empty invitation field, and the generic invalid-file message.

On the hosting development laptop, all four existing LocalFirst JSON downloads were `diwan-local-workspace` backups, with no invitation field. No downloaded Bluetooth invitation was present. Loading a workspace backup reproduced the exact screenshot message in Chrome. The actual file selected on the other physical laptop has not been inspected, so its precise contents remain unconfirmed. The user subsequently asked where the invitation file is created.

The application previously described every parsed but mismatched file as invalid without explaining that **Export workspace** and **Save invitation file** create different files. That made the setup failure difficult to recover from. Separately, a rejected import left any previously loaded invitation active, JSON parse/read failures surfaced technical errors, pasted malformed codes could reach Connect, and expired hosts could still offer their old invitation for download.

## Changes

- Added a shared bounded invitation parser/serializer. Existing version-1 exports remain compatible; complete plain-text/JSON-string codes and UTF-8 BOM/line wrapping are supported. Unsupported versions, arbitrary files, missing/truncated codes and oversized input remain rejected.
- Identify workspace backups and connection reports with instructions to create the correct file on the hosting laptop. Explain its filename, Downloads location and Ctrl+J.
- Clear a previous invitation before importing another file. Disable Connect until a complete valid invitation, a paired host and an active radio are selected.
- Disable copying/exporting an expired host invitation. Convert file-read failures to an actionable message without logging invitation secrets.
- Added 25 parser tests and a Chrome test transferring the exact exported file between isolated app profiles, rejecting wrong/malformed files, and verifying no connection request is sent for rejected input.

## Preservation and verification

Before changes, all 711 tracked/untracked source files and the tracked diff were copied to a separate workspace backup. This fix does not change the document database schema, saved document records, replica journal, native transport protocol or existing hosted deployment. Old extracted packages remain available. Update using the same browser/profile and `http://127.0.0.1:8765` origin; save work and close all LocalFirst tabs before reopening the updated launcher. Do not clear browser data.

TypeScript, 133 focused tests across 13 files and all 18 Chrome scenarios pass. The Chrome suite includes existing document saving, recovery, history, offline restart and replica convergence checks. The standalone package check additionally verifies a real Go-generated invitation survives browser download/import without printing or retaining its secret in reports.

Two physical laptops have not yet completed a verified bidirectional document exchange. Successful invitation loading removes the reported setup blocker; RFCOMM connection and real peer edits still require the physical checklist in [WINDOWS-BLUETOOTH.md](WINDOWS-BLUETOOTH.md). These checks do not certify every possible device, failure mode or production scenario.
