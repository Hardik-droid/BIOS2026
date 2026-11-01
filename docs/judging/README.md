# BIOS2026: project documentation and judge preparation

**Edition:** 1 November 2026. **Code baseline:** [`d7e9135`](https://github.com/Vasu-Gupta105/BIOS2026/commit/d7e9135c65860530032173fecfb81eff696af6c6). This pack documents the local workspace and the available test reports; it is not a production certification.

## Read or print

| Document | What you will find |
| --- | --- |
| [Complete printable PDF](exports/BIOS2026-Project-and-Judges-Guide.pdf) | All four chapters in one searchable, bookmarked document, with diagrams and linked contents. |
| [Technical handbook](PROJECT-HANDBOOK.md) | Technology versions, inheritance, architecture, data models, save/recovery logic, CRDT synchronization, Bluetooth/TLS, native API, Android relay, limits, builds and failure cases. |
| [USP and competitive landscape](USP-AND-COMPETITIVE-LANDSCAPE.md) | Defensible positioning, a capability matrix, detailed alternatives, business hypotheses and direct primary-source references. |
| [Demo and technical defence](DEMO-AND-DEFENCE.md) | Thirty-second and ninety-second pitches, three-minute structure, a ten-minute demonstration timeline, failure responses and evidence to carry. |
| [200 judge questions and answers](JUDGES-QUESTIONS-AND-ANSWERS.md) | Beginner-to-expert questions, model answers, follow-ups and difficult claim/ownership/security questions. |

The Markdown is the editable source. The PDF is a generated print export, not a separate competing version of the documentation. To regenerate it after installing the project's existing web dependencies, run this from the repository root:

```powershell
node scripts/render-judging-guide.mjs
```

The renderer uses the local Marked, Mermaid and Playwright/Chrome tools. It writes one canonical PDF and an export manifest under `exports/`, which is excluded from Git. It does not contact a cloud rendering service or modify product source.

## The five facts every presenter must know

1. **LocalFirst extends the original Diwan office suite.** The office engines, substantial Go/backend code and existing online collaboration infrastructure are inherited. Explain the added offline, recovery, native Bluetooth and relay work specifically.
2. **The offline Windows app is the current working foundation.** Its browser profile stores the documents. Local save success is different from inter-device synchronization, and Docs has stronger verification than the entire office feature surface.
3. **Native nearby sharing and Android relays have distinct evidence levels.** Source implementations, memory/loopback tests, one-radio owner tests and a complete physical multi-device transfer are different claims. The available reports do not independently establish the last one.
4. **The relay is a fixed-route prototype.** Participating, powered, consenting devices forward the endpoints' encrypted stream. Arbitrary nearby devices, automatic mesh routing and an 800 m–1 km range are not current verified capabilities.
5. **Encryption has a scope.** The transport design protects document content in transit using existing cryptography. It does not encrypt the browser's local database or JSON backups at rest, conceal all traffic metadata, prevent jamming or secure a compromised endpoint.

## Suggested study routes

**If you have fifteen minutes:** read handbook sections 1–5 and 19, the competitor chapter's claim ladder and comparison table, then rehearse the eight short answers in the demo guide.

**If you have an hour:** add the ordinary-save, draft-recovery, Yjs journal, state-vector acknowledgement and TLS sections. Practise the question bank by topic. Answer aloud before reading each model answer, then point to the supporting code or test.

**If you will defend implementation details:** trace one typed edit through the editor, draft, local API and committed snapshot; then trace an opted-in shared edit through the Yjs journal, native bridge, encrypted stream, destination commit and acknowledgement. Be able to explain why vector equality alone is insufficient for deletion durability.

## Evidence rules

The local reports record 19 Chrome scenarios, a historical focused run of 133 tests, 23 phase-one relay leaf scenarios repeated ten times, 108 JVM checks and nine tagged connector scenarios repeated three times. These counts have different scopes and must not be added into a coverage percentage. Test repetition is not scenario breadth, and simulated hops are not radio-distance measurements.

The user has reported that the current app works well. That feedback belongs in the story as user feedback. It should not be recast as an independently instrumented range, Android lifecycle or physical peer-transfer test.

Older repository documents sometimes describe earlier milestones or the inherited online product. Where statements differ, inspect the actual mode, source path and evidence date. This pack explicitly separates those modes instead of combining their strongest claims into one imaginary release.

## Publication and reproducibility gap to disclose

At the historical `d7e9135` commit, the unanchored `diwan` ignore rule also matched the Android Java package path `org/diwan`, so the published snapshot omitted local Java source and tests. The current LocalFirst binary ignore is anchored as `/localfirst`; the Android `org.diwan` package remains a compatibility identifier. This current fix does not alter the historical commit. A clean-clone Android build and source-publication check remain separate release validation steps.

Historical report and launcher basenames below retain their original `Diwan-*` spelling where those are the actual files in the parent workspace. They are evidence identifiers, not the current product brand.

## Before sharing with judges

Use the safe demo document and do not project real invitations or credentials. Recheck competitor claims if presenting later, since their editions and features may change. Replace hypothetical customer, cost or latency statements with measured results only when those results exist. The question bank is broad preparation, not a promise to anticipate every conceivable question.
