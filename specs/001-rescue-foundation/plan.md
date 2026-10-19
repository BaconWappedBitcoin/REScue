# Implementation Plan: REScue Foundation — RES for Modern Reddit

**Branch**: `001-rescue-foundation` | **Date**: 2026-10-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-rescue-foundation/spec.md`

## Summary

REScue is a Manifest V3 browser extension for `www.reddit.com` and `sh.reddit.com`. It runs
RES-equivalent feature modules on Reddit's own layout.

**Amended 2026-10-15 (native-only pivot)**: the classic (old-reddit) layout is removed for 1.0 and
archived at git tag `archive/classic-layout`; the anti-flash gate goes with it. RES features modern
Reddit already provides are Built-in (feature matrix) and not rebuilt.

The technical approach:
1. Read the data Reddit already put in `shreddit-*` element attributes into typed models.
2. Decorate Reddit's own posts and comments only at anchors verified live (R17): beside the author
   link, and in the `credit-bar`, `title` and `commentMeta` slots. Never hide or replace the page.
3. Process content as Reddit adds it (MutationObserver pipeline); Reddit loads more itself.

Every Reddit-owned selector lives in one contracts module. Feature modules plug into a typed
registry with options and health checks. Hover cards use Reddit's own
same-origin hover-card partials ([research.md](./research.md) R4/R5). Signed-in actions are
delegated to Reddit's own controls and confirmed before success is shown (R10).

## Technical Context

**Language/Version**: TypeScript 5.x (strict), ES2022 target

**Primary Dependencies**: WXT (MV3 build and cross-browser manifests), Preact (settings console and
options page only), `webextension-polyfill` via WXT. No runtime dependency for content rendering
(an in-house `h()` DOM builder).

**Storage**: `browser.storage.local` with `unlimitedStorage` for all user data;
`browser.storage.sync` for the settings profile only (chunked); versioned schemas with startup
migrations (R12)

**Testing**: Vitest + happy-dom (unit and fixture); Playwright with the packed Chromium extension
(decorations, keyboard, settings); Playwright Firefox smoke; a live-contract runner against real
`www.` and `sh.reddit.com` (R15)

**Target Platform**: Chrome/Edge/Brave 120+ (primary) and Firefox 128+ (MV3). Desktop only.

**Project Type**: Browser extension (single project)

**Performance Goals**: ≤100 ms main-thread work per incoming content batch (constitution); filtered
and decorated within 200 ms of arrival (SC-004)

**Constraints**: No remote code, no telemetry, no non-Reddit requests by default (SC-006), no
credential handling (Principle V), never hide or replace Reddit's page (FR-005). All REScue network calls go through
`src/core/net.ts` (same-origin or granted hosts only; SC-006). Hover fetches
are rate-limited and cached (R4).

**Scale/Scope**: 81 RES modules triaged; 49 Ported or Adapted targeted for 1.0 and 22 Built-in,
delivered story-by-story (US1–US8, US4 withdrawn); threads of 5,000+ comments

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-research | Post-design |
|---|---|---|---|
| I. Read From the Page, Decorate Reddit's Own Layout (v2.0.0) | All Reddit selectors in `src/contracts/`; additions only at verified anchors; page never hidden | PASS: R2, R17 | PASS: [contracts/page-contracts.md](./contracts/page-contracts.md) defines the single registry; modules receive models, never selectors |
| II. Honest Feature Parity | Matrix covers all modules; no unconfirmed success UI | PASS: matrix 81/81 | PASS: matrix updated from research; action contract requires confirmation (module-api `ActionResult`) |
| III. Fail Visible, Fall Back Native | Per-module health; isolated init | PASS | PASS: module lifecycle includes `health()` and an error boundary |
| IV. Local-First Privacy | No telemetry; requests limited to Reddit and opted-in hosts | PASS | PASS: hover fetches same-origin only; external hosts are optional permissions (R13) |
| V. Delegate, Never Impersonate | No credentials; actions delegated and confirmed | PASS | PASS: no token storage in data model; R10 delegation |
| VI. Test Against Fixtures and Live Contracts | Fixture suites plus a live-contract runner | PASS | PASS: R15; the contracts doc requires every contract to carry a live-verify probe |
| Platform & Licensing | MV3, Chromium + Firefox, GPL-3.0, attribution | PASS | PASS: R14 attribution headers |

No violations, so the Complexity Tracking table is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-rescue-foundation/
├── plan.md              # This file
├── spec.md              # Feature specification
├── feature-matrix.md    # RES module triage (Principle II)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── module-api.md        # Module registry and lifecycle contract
│   ├── page-contracts.md    # Reddit DOM/endpoint contract registry
│   ├── storage-schema.md    # Persisted data and export file format
│   └── messaging.md         # Isolated world ↔ main-world bridge ↔ background
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks; not created here)
```

### Source Code (repository root)

```text
wxt.config.ts                 # Manifest: hosts, permissions, optional host permissions
src/
├── entrypoints/
│   ├── content.ts            # Isolated-world content script (document_start)
│   ├── bridge.content.ts     # MAIN-world bridge: loadContent(), native control clicks
│   ├── background.ts         # Storage migrations, permission requests, sync chunking
│   └── options/              # Options page (Preact), mounts the settings console
├── contracts/
│   ├── reddit.ts             # ALL Reddit selectors, attributes, endpoints (single point of breakage)
│   └── probes.ts             # Live-verify probes per contract (used by tests/live)
├── core/
│   ├── route.ts              # SPA route classification and change events
│   ├── pipeline.ts           # MutationObserver → rAF-batched work queue
│   ├── paginator.ts          # Drives programmatic partials (feed and comment tree)
│   ├── registry.ts           # Module registry, lifecycle, error boundaries, health
│   ├── settings.ts           # Settings profile load/save/defaults/presets
│   ├── storage/              # Typed stores, migrations, sync chunking, pruning
│   ├── bridge-client.ts      # Isolated-side RPC to the MAIN-world bridge
│   ├── hovercards.ts         # Fetch, parse, cache, back-off (R4/R5)
│   ├── notices.ts            # Toast/notice framework (RES notifications)
│   ├── keys.ts               # Capture-phase key dispatcher (R11)
│   ├── hover.ts              # Hover popup framework (RES hover)
│   ├── actions.ts            # ActionApi: delegated, confirmed signed-in actions (R10)
│   ├── net.ts                # The only network entry point: same-origin or granted hosts
│   ├── types.ts              # Module/registry types
│   └── dom.ts                # h() builder, escaping, time/number formatting
├── model/
│   ├── post.ts  comment.ts  profile-comment.ts  session.ts  media.ts
├── layout/
│   └── native/               # Finds Reddit's posts/comments; places decorations at verified anchors
├── modules/
│   ├── core/                 # settingsConsole, backupRestore, presets, customToggles, commandLine, troubleshooter, about
│   ├── listings/             # filteReddit, neverEndingReddit, keyboardNav, showImages, singleClick, autoHide, …
│   ├── comments/             # commentNavigator, hideChildComments, newCommentCount, saveComments, showParent, …
│   ├── users/                # userTagger, userHighlight, userInfo, usernameHider, penaltyBox
│   ├── actions/              # voting/save/hide/reply delegation, commentTools, commentPreview, voteEnhancements
│   └── appearance/           # themes/nightMode, customCss, localDate, subredditManager, pageNavigator, …
├── ui/
│   └── settings-console/     # Preact settings console (shadow-root mounted)
└── styles/
    └── suppress.css          # REScue's own UI styles and opt-in hides (login wall, chat)
tests/
├── unit/                     # Vitest: models, filters, parsers, registry, storage migrations
├── fixtures/                 # Synthetic pages from captured structure (+ hover-card fragments)
├── browser/                  # Playwright + packed extension (Chromium), Firefox smoke
└── live/                     # verify-contracts.ts (drift report) + capture.ts (page-structure capture)
```

**Structure Decision**: Single browser-extension project laid out the way WXT expects
(`src/entrypoints`). Feature modules are grouped by RES category, one file per module (each under
500 lines). Reddit coupling is confined to `src/contracts/` and `src/model/`, and modules consume
typed models only (Principle I).

## Delivery Order

The order matches the spec priorities; each phase ends with a shippable build.

1. **Platform** (done): contracts, route, pipeline, registry, storage, settings, bridge.
2. **US1 + US2 (P1)** (done): settings console, backup/restore, presets, filteReddit. MVP.
3. **Native pivot** (2026-10-15): remove the classic layout and gate; native decoration slots in
   the native adapter (R17).
4. **US3, US5 (P2)**: keyboard navigation over Reddit's items; userTagger, userHighlight. (US4
   withdrawn: Built-in.)
5. **US6, US7 (P3)**: comment tools; keyboard vote/save pressing Reddit's controls, confirmed.
6. **US8 (P4)**: custom CSS, local dates, username hiding, shortcut bar.

## Risks

| Risk | Mitigation |
|---|---|
| Reddit renames attributes or elements | Single contracts file, per-module health, live-contract runner (Principles I/III/VI) |
| Hover partial Accept header stops returning fragments | Full-page fallback parse plus cache (R4) |
| Signed-in delegation breaks when native controls move | Confirmation-gated UI; actions fall back to "open on Reddit" with draft preserved (R10) |
| Bot challenges block the live-contract runner | Report "blocked" and never solve challenges (R15) |
| `sh.reddit.com` diverges signed in | Per-host contract overrides; live runner covers both hosts (R9) |
| Store review of a broad host permission | Hosts limited to the three Reddit origins; media hosts are optional permissions |

## Complexity Tracking

> No Constitution Check violations; nothing to justify.
