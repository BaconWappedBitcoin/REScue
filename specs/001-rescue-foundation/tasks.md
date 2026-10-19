---

description: "Task list for 001-rescue-foundation: REScue, RES for modern Reddit"
---

# Tasks: REScue Foundation — RES for Modern Reddit

**Input**: Design documents from `specs/001-rescue-foundation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md),
[feature-matrix.md](./feature-matrix.md)

**Tests**: INCLUDED. Constitution Principle VI requires test-first development against fixtures plus
a live-contract check. In each story, write the test tasks first and confirm they fail before
implementing.

**Amended 2026-10-15 (native-only pivot)**: the classic layout is removed for 1.0 and archived at git
tag `archive/classic-layout`. Classic tasks are marked *Superseded*, RES features Reddit already
provides are marked *Withdrawn: Built-in*, and replacement work is T123–T131. IDs are never
renumbered.

**Organization**: Grouped by user story (US1–US8 from spec.md). Each module task names its RES
module id from feature-matrix.md for traceability.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete tasks)
- **[Story]**: US1–US8, mapping to spec.md user stories
- Paths follow plan.md: `src/`, `tests/` at repository root (WXT layout)

## Conventions every task follows

- **Selectors**: Every Reddit selector, attribute, endpoint, or header goes in
  `src/contracts/reddit.ts` with a probe in `src/contracts/probes.ts`. Never put them in modules
  (contracts/page-contracts.md).
- **Modules**: Every module is a `ModuleDefinition` (contracts/module-api.md) registered in
  `src/modules/index.ts`, with `resId` and an option schema. There is no hand-written
  settings UI.
- **Attribution**: Files porting RES or Sheddit logic start with a GPL-3.0 attribution header naming
  the upstream file (research R14).
- **Size**: Keep each file under 500 lines.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and tooling

- [X] T001 Initialize npm project with WXT + TypeScript 5 (strict) + Preact in package.json, wxt.config.ts, tsconfig.json (target ES2022, `strict: true`)
- [X] T002 Configure wxt.config.ts manifest: name "REScue", MV3, content-script matches `*://www.reddit.com/*`, `*://reddit.com/*`, `*://sh.reddit.com/*` (exclude `*://*.reddit.com/media*`), permissions `storage`, `unlimitedStorage`, empty `optional_host_permissions` list placeholder, Firefox `browser_specific_settings.gecko.id`
- [X] T003 [P] Add LICENSE (GPL-3.0-or-later full text), PRIVACY.md (states REScue initiates no third-party requests by default; lists the same-origin hover-card endpoints `/svc/shreddit/user-hover-card/{name}` and `/svc/shreddit/community-hover-card/{name}`; constitution Principle IV), and NOTICE crediting RES (honestbleeps/Reddit-Enhancement-Suite) and Sheddit (kookaburrabarrel/sheddit) at repository root
- [X] T004 [P] Configure ESLint (typescript-eslint, `no-restricted-syntax` rule banning string literals matching `shreddit-|faceplate-|data-testid` outside src/contracts/) and Prettier in eslint.config.js, .prettierrc; also ban direct `fetch(` and `XMLHttpRequest` outside src/core/net.ts
- [X] T005 [P] Configure Vitest with happy-dom in vitest.config.ts; scripts `test`, `test:watch` in package.json
- [X] T006 [P] Configure Playwright for packed-extension Chromium + Firefox projects in playwright.config.ts; scripts `test:browser`, `verify:live` in package.json
- [X] T007 [P] Add GitHub Actions CI running lint, typecheck, `npm test`, `npm run build`, Chromium and Firefox browser suites in .github/workflows/ci.yml
- [X] T008 Create directory skeleton per plan.md: src/{entrypoints,contracts,core,core/storage,model,layout/classic,layout/native,modules/{core,listings,comments,users,actions,appearance},ui/settings-console,styles}, tests/{unit,fixtures,browser,live}

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contracts, models, pipeline, registry, storage, bridge, and gate that every story
needs

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tests for Foundation (write first, must fail)

- [X] T009 [P] Build fixture generators from Sheddit's live-captured structure in tests/fixtures/pages.ts: listing (posts + ad + feed partial + hover-card partials), comment thread in BOTH nesting orders (flat-with-depth and DOM-nested), profile comments, custom-feed listing, empty feed (`[data-testid="no-content"]`), signed-in and signed-out session markers
- [X] T010 [P] Save hover-card fragments from research R4/R5 (user found, user not found, community) as tests/fixtures/hovercards/{user-spez.html,user-missing.html,community-programming.html}
- [X] T011 [P] Unit tests for post/comment/session models in tests/unit/model.test.ts: skip a post missing any of `id`/`title`/`permalink`; dedupe ids; comment tree built from `depth` matches under both nesting orders; comment body scoped via `closest(COMMENT) === el`; `isOp` = `author === post.author`
- [X] T012 [P] Unit tests for module registry in tests/unit/registry.test.ts: dependsOn resolution, init throw → module `disabled` and others continue, 3 errors per page → disabled, layout filtering (`classic`/`native`)
- [X] T013 [P] Unit tests for storage in tests/unit/storage.test.ts: migrations run in order on a copy, failed migration leaves data untouched, sync chunking ≤7 KB with hash check, debounce 250 ms
- [X] T014 [P] Unit tests for hovercard parser + cache in tests/unit/hovercards.test.ts: label-paired karma (mismatched label → `undefined`), cake day ISO parse, not-found card → `found: false`, 30-min TTL, 500-entry LRU, single in-flight request per name, 429 → 5-minute global back-off
- [X] T015 [P] Browser test for gate in tests/browser/gate.spec.ts: native layout hidden from document_start; forced render failure restores native within the FR-007 deadline (1.5 s after DOMContentLoaded with no content items and no empty-feed marker; 5 s hard cap from navigation start; 3 s after an in-app route change) with notice; never blank (quickstart scenario 6) *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*

### Implementation for Foundation

- [X] T016 Create contracts registry with the `PageContract` type and all inherited/verified entries from contracts/page-contracts.md in src/contracts/reddit.ts
- [X] T017 [P] Create live-verify probes (page type + expectation per contract key) in src/contracts/probes.ts
- [X] T018 [P] Implement `h()` DOM builder, HTML escaping, sanitizer for body HTML, relative-time and number formatting in src/core/dom.ts
- [X] T019 [P] Implement Post model parser (fields and required triad per data-model.md; `type` unknown → `'other'`) in src/model/post.ts
- [X] T020 [P] Implement Comment model parser (threading from `depth` + `comment-position`, never DOM shape; `distinguished` null unless the candidate contract is present) in src/model/comment.ts
- [X] T021 [P] Implement profile-comment parser in src/model/profile-comment.ts and Session reader (`after-login-toast-dispatcher[username]` first, anchors as fallback) in src/model/session.ts
- [X] T022 [P] Implement MediaDescriptor extraction for Reddit-hosted image/gallery/video/gif (DASH manifest + audio pairing ported from Sheddit media.js) in src/model/media.ts
- [X] T023 Implement route classifier and SPA route-change events (navigation API + URL polling fallback; classify custom-feed and search routes; search is marked classic-renderable only when the `search.post` contract status is verified, else native) in src/core/route.ts
- [X] T024 Implement MutationObserver → rAF-batched pipeline emitting `ItemBatch`, with a per-batch timing budget warning above 100 ms, in src/core/pipeline.ts
- [X] T025 Implement typed stores, debounce/batch writes, migrations runner, sync chunking, and pruning (read: LRU >50,000 threads or >90 days) per contracts/storage-schema.md in src/core/storage/{store.ts,migrations.ts,sync.ts,prune.ts}
- [X] T026 Implement SettingsProfile load/save/defaults with option-schema validation (invalid → default + notice; unknown module ids preserved) in src/core/settings.ts
- [X] T027 Implement module registry, `ModuleContext`, lifecycle, error boundaries, and health per contracts/module-api.md in src/core/registry.ts and src/core/types.ts
- [X] T028 [P] Implement notice/toast framework (RES `notifications`) in src/core/notices.ts
- [X] T029 [P] Implement capture-phase key dispatcher and command registry (ignore editable targets via composedPath incl. shadow roots; stopImmediatePropagation when handled; shield REScue inputs from Reddit handlers; research R11) in src/core/keys.ts
- [X] T030 [P] Implement hover popup framework (RES `hover`: open delay 500 ms default, fade, close-on-mouseout option) in src/core/hover.ts
- [X] T031 [P] Implement network guard (the only network entry point: allows same-origin URLs and granted media hosts only, rejects everything else with a logged error; SC-006) in src/core/net.ts
- [X] T032 Implement hovercard fetch/parse/cache/back-off (via src/core/net.ts, same-origin, `credentials: 'include'`, Accept `text/vnd.reddit.partial+html, text/html;q=0.9`, DOMParser, full-page fallback) in src/core/hovercards.ts (depends on T016, T030)
- [X] T033 Implement MAIN-world bridge (token handshake, `partial.load`, `native.click`, `composer.insert`, `composer.submit`, 5 s timeouts) per contracts/messaging.md in src/entrypoints/bridge.content.ts
- [X] T034 Implement isolated-side bridge RPC client in src/core/bridge-client.ts
- [X] T035 Implement paginator driving feed partials (excluding `hover-card` src) and comment-tree partials via the bridge, with its own sentinel and dedupe, in src/core/paginator.ts
- [X] T036 Implement document_start suppression stylesheet (hide native subtree by clipping/opacity, keep it laid out for delegation; research R10) in src/styles/suppress.css *(Amended 2026-10-15: native hiding removed in T123; the file keeps REScue UI styles and opt-in hides)*
- [X] T037 Implement content-aware gate (FR-007 deadline: earlier of 1.5 s after DOMContentLoaded with no content items and no empty-feed marker, or 5 s after navigation start; 3 s after in-app route change; early unblank when no feed, failure notice, `rescueForceFail` dev hook) in src/core/gate.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*
- [X] T038 Implement background script: migrations at startup, `settings.changed` broadcast, `permissions.request`, `backup.export`/`backup.import`, `health.report` in src/entrypoints/background.ts
- [X] T039 Wire the content entrypoint: gate at document_start → settings → session → registry → pipeline → layout in src/entrypoints/content.ts and the module index in src/modules/index.ts
- [X] T040 Implement live-contract runner (visits www. and sh. listing/thread/profile; reports per-contract hit rates; reports `blocked` on bot challenge and never solves it) in tests/live/verify-contracts.ts
- [X] T041 Implement page-structure capture tool (real browser profile; saves sanitized DOM structure of a search results page, a custom feed, an 18+ age-gated subreddit, and a login-wall overlay into tests/fixtures/captured/; never solves bot challenges) in tests/live/capture.ts, then set `search.*`, `customFeed.feed`, `ageGate.confirm`, `loginWall.overlay` contract statuses in src/contracts/reddit.ts from the results

**Checkpoint**: Foundation ready. Models parse fixtures, modules can register, and the pipeline
emits batches.

---

## Phase 3: User Story 1 - Classic layout + settings console (Priority: P1) 🎯 MVP

**Goal**: Front page, subreddits, profiles, and threads render in the classic layout on www. and
sh. A settings console manages all modules, with backup/restore and presets.

**Independent Test**: quickstart scenarios 1–4. Classic rows and comment tree with no flash; a
toggle persists after reload; export → reset → import restores everything; turning the classic
layout off shows native Reddit.

### Tests for User Story 1

- [X] T042 [P] [US1] Fixture render tests for classic listing rows (rank, score, thumbnail, title, domain, submitter, age, comment count, subreddit) and indented comment tree in tests/unit/classic-layout.test.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*
- [X] T043 [P] [US1] Unit tests for settings console schema rendering (every option type: boolean, enum, text, number, color, keybinding, list, table) in tests/unit/settings-console.test.ts
- [X] T044 [P] [US1] Unit tests for backup export/import (format `rescue-backup`, formatVersion 1, migrations from older schemaVersion, replace vs merge, 50 MB cap, `read` optional) in tests/unit/backup.test.ts
- [X] T045 [P] [US1] Browser test: module toggle persists across reload and layout toggle switches to native in tests/browser/us1-settings.spec.ts *(Amended 2026-10-15: the layout-toggle half is removed in T123)*
- [X] T046 [P] [US1] Browser tests for interstitials (FR-008) in tests/browser/us1-interstitials.spec.ts: age gate shows REScue notice; `over18` bridge click is sent only after Continue; `autoConfirmAgeGate` defaults to false; `removeLoginWall` defaults to false and hides the overlay only when enabled; no log-in or sign-up control is ever clicked

### Implementation for User Story 1

- [X] T047 [P] [US1] Port old-reddit skin (from Sheddit old-reddit.css) in src/styles/classic.css *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*
- [X] T048 [P] [US1] Implement classic listing renderer (front page, subreddits, custom feeds, and search results when classic-renderable per route.ts; post rows, thumbnails, page separators, empty-feed and hidden-profile notices) in src/layout/classic/listing.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*
- [X] T049 [P] [US1] Implement classic comment-tree renderer (nested `.child` containers from depth, collapse toggles, "load more comments" hook to paginator) in src/layout/classic/comments.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*
- [X] T050 [P] [US1] Implement classic header, tab bar with sort-period dropdowns (`temporaryDropdownLinks`), and sidebar in src/layout/classic/chrome.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*
- [X] T051 [P] [US1] Implement profile renderer (overview/posts/comments tabs; `profileNavigator`) in src/layout/classic/profile.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*
- [X] T052 [US1] Implement layout controller: classic on by default (FR-005), toggle to native, native adapters exposing items to N-capable modules, in src/layout/index.ts and src/layout/native/adapter.ts *(Amended 2026-10-15: classic half removed in T123; native adapter kept and extended in T124)*
- [X] T053 [US1] Implement Preact settings console (module list by category, search, enable toggles, schema-generated options, deep links `#rescue:settings/<moduleId>`) mounted in a shadow root in src/ui/settings-console/
- [X] T054 [US1] Implement gear menu entry point on classic header and floating button on native (RES `menu`, `settingsNavigation`) in src/modules/core/settingsConsole.ts *(Amended 2026-10-15: floating gear only)*
- [X] T055 [P] [US1] Implement `backupAndRestore` module (file export/import UI, sync toggle) in src/modules/core/backupRestore.ts
- [X] T056 [P] [US1] Implement `presets` ("Lite", "Classic RES", "Clean slate") and `customToggles` modules in src/modules/core/presets.ts (both modules)
- [X] T057 [P] [US1] Implement `troubleshooter` (reset, clear caches, contract-health report) and About panel (merges version/announcements/about/RESTips/onboarding, contribute and submitIssue links with health report) in src/modules/core/troubleshooter.ts (both modules)
- [X] T058 [P] [US1] Implement `xPostLinks`, `quarantineHide` (visible interstitial, never auto-accept unless enabled), `profileRedirect` (plus the `oldRedditRedirect` switch) in src/modules/listings/listingTweaks.ts *(Amended 2026-10-15: `xPostLinks` removed in T123 — Built-in)*
- [X] T059 [P] [US1] Implement `betteReddit` subset (pinned header, "full comments" links, unhide) and `penaltyBox` in src/modules/listings/betteReddit.ts and src/modules/users/penaltyBox.ts *(Amended 2026-10-15: `betteReddit` removed in T123 — Built-in; `penaltyBox` kept)*
- [X] T060 [US1] Implement optional old.reddit.com → www redirect with short notice in src/entrypoints/oldreddit.content.ts
- [X] T061 [US1] Implement `interstitials` module (FR-008): REScue 18+ notice with Continue that sends bridge `native.click` control `over18`; option `autoConfirmAgeGate` (default false); option `removeLoginWall` (default false) hiding the `loginWall.overlay` contract element; never clicks log-in/sign-up; in src/modules/listings/interstitials.ts

**Checkpoint**: The MVP is browsable in the classic layout with settings, backup, and presets.

---

## Phase 4: User Story 2 - Filter out unwanted content (Priority: P1)

**Goal**: filteReddit parity: keyword, subreddit, domain, user, flair, and NSFW, with scoping,
regex, and reveal. Works on classic and native.

**Independent Test**: quickstart scenario 5. Keyword and subreddit filters hide matches on `/r/all`
before display, including endless-scroll batches. The counter and "show filtered" work.

### Tests for User Story 2

- [X] T062 [P] [US2] Unit tests for filter matching in tests/unit/filters.test.ts: each type; `isRegex` patterns "must compile (`/body/flags` syntax)", invalid → rejected at input and disabled at load; scope modes `everywhere|only|except`; case-insensitive keywords
- [X] T063 [P] [US2] Browser test: filters apply to newly loaded batches before paint on classic AND native in tests/browser/us2-filters.spec.ts *(Amended 2026-10-15: native only)*

### Implementation for User Story 2

- [X] T064 [P] [US2] Implement FilterRule store and matcher (port matching logic from RES filteReddit with attribution) in src/modules/listings/filteReddit/rules.ts
- [X] T065 [US2] Implement `filteReddit` module (onItems hide with reason, filtered counter, "show filtered" reveal with matched rule, `table` option editor) in src/modules/listings/filteReddit/index.ts
- [X] T066 [US2] Implement native-layout hiding of `article` wrappers via native adapter for filteReddit in src/layout/native/adapter.ts
- [X] T130 [P] [US2] Implement `subredditTagger` (tag in the post's `credit-bar` slot) in src/modules/listings/subredditTagger.ts
- [X] T132 [US2] Inline filter controls (RES parity): a ⊘ button on each post and a toggle on subreddit pages add or remove subreddit/user/domain filter rules with instant effect and Undo, in src/modules/listings/filteReddit/inline.ts and index.ts
- [X] T067 [P] [US2] Implement `subredditTagger` (tag posts by subreddit on `/r/all`) in src/modules/listings/subredditTagger.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)* Replaced by T130.

**Checkpoint**: US1 + US2 make up MVP release 1.

---

## Phase 4b: Native-only pivot (2026-10-15)

**Goal**: REScue enhances Reddit's own layout only (constitution v2.0.0, spec FR-005). Remove the
classic layout and gate; give modules one way to place decorations at verified anchors (R17).

- [X] T123 Remove the classic layout: src/layout/classic/, src/styles/classic.css, src/core/gate.ts and the gate/native-hiding rules in src/styles/suppress.css, the classic layout setting and console toggle, the classic-only modules (keyboardNav, browsing, showImages, betteReddit, xPostLinks, subredditTagger) and their tests; src/entrypoints/content.ts always runs the native layout; drop `layouts` from module definitions
- [X] T124 Native decorations: contracts for the post author link, `credit-bar`, `title` and comment `commentMeta` anchors in src/contracts/reddit.ts (+ probes); a decoration API in src/layout/native/adapter.ts placing module elements beside the author link or in those slots, idempotent per item; unit tests against fixtures in tests/unit/native-decorations.test.ts
- [X] T125 [P] Extend tests/live/verify-contracts.ts to check the T124 anchors on a listing and a thread on www. and sh. *(Run 2026-10-15: all four anchor contracts 100% on www. and sh.; with the built extension on a live r/science thread, the tag and tally render after the post author, an ignored comment collapses only its own body with its replies still shown and the toggle restores it, and AutoModerator gets the moderator highlight)*
- [X] T126 [P] Update research.md (R17 native anchors), quickstart.md, data-model.md and contracts/*.md for the pivot

**Checkpoint**: Reddit's page is never hidden; filters, settings and interstitials still pass.

---

## Phase 5: User Story 3 - Keyboard navigation & endless scrolling (Priority: P2)

**Goal**: RES keyboardNav command set, selected entry, wheel browse, single click, command line,
and neverEndingReddit.

**Independent Test**: quickstart scenario 7. j/k past the end loads more and keeps the selection
in view; typing "j" in any text box types normally; rebinding works; `?` shows help.

### Tests for User Story 3

- [X] T068 [P] [US3] Unit tests for command table and rebinding (KeyChord parsing, conflicts) in tests/unit/keyboard.test.ts
- [X] T069 [P] [US3] Browser tests: j/k selection and scroll, shortcuts ignored in REScue textarea and Reddit rich-text editor (shadow DOM), endless load with separator and dedupe in tests/browser/us3-keynav.spec.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)* Replaced by T128.

### Implementation for User Story 3

- [X] T070 [US3] Implement `keyboardNav` + `selectedEntry` (port RES command table: move up/down, sibling/parent/thread moves, follow link/comments, expando toggle, vote, save, hide, link numbers, help overlay `?`) in src/modules/listings/keyboardNav/{commands.ts,index.ts,help.ts} *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)* Replaced by T127.
- [X] T071 [P] [US3] Implement `neverEndingReddit` (auto/on-demand modes, page separators, "load more" button fallback) in src/modules/listings/browsing.ts *(Withdrawn 2026-10-15: Built-in — Reddit loads more posts itself)*
- [X] T072 [P] [US3] Implement `wheelBrowse` and `singleClick` in src/modules/listings/browsing.ts (with neverEndingReddit) *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)* Replaced by T129.
- [X] T127 [US3] Implement `keyboardNav` + `selectedEntry` over Reddit's posts and comments (outline on the selected item, j/k, enter/c, shift+j/k between threads, go-mode, `?` help; scrolling near the end lets Reddit load more and the selection continues) in src/modules/listings/keyboardNav/, reusing the archived command table
- [X] T128 [P] [US3] Browser tests for T127 against the native fixtures (selection, text-field passthrough including shadow editors, continuing onto newly loaded posts, rebinding) in tests/browser/us3-keynav.spec.ts
- [X] T129 [P] [US3] Implement `wheelBrowse` and `singleClick` ("[l+c]" in the post's `credit-bar` slot) in src/modules/listings/browsing.ts
- [X] T073 [P] [US3] Implement `commandLine` (navigation, settings, toggle commands from the registry) in src/modules/core/commandLine.ts

---

## Phase 6: User Story 4 - Inline media expansion (Priority: P2)

**Goal**: showImages for Reddit-hosted media first, then opt-in external hosts with per-host
optional permissions.

**Independent Test**: quickstart scenario 8. "view images" expands image, gallery, and video
inline; each gallery image appears exactly once; drag-resize works; NSFW stays hidden until
revealed; unsupported hosts show no expando.

### Tests for User Story 4

- [X] T074 [P] [US4] Unit tests for media descriptors and host matchers (gallery dedupe, lazy-src upgrade, unsupported host → null) in tests/unit/media.test.ts *(Kept: media descriptors still feed filteReddit and future Deferred hosts)*
- [X] T075 [P] [US4] Browser tests: expand/collapse, drag resize, gallery stepping, video+audio pairing in tests/browser/us4-media.spec.ts *(Superseded 2026-10-15: classic layout archived at tag `archive/classic-layout`; see T123)*

### Implementation for User Story 4

- [X] T076 [US4] Implement `showImages` core (expando buttons, view-all toggle, viewport-capped sizing, drag resize, NSFW blur/reveal) in src/modules/listings/showImages/index.ts *(Withdrawn 2026-10-15: Built-in — Reddit expands media inline)* Archived.
- [X] T077 [P] [US4] Implement gallery viewer (step, captions, keyboard prev/next) in src/modules/listings/showImages/gallery.ts *(Withdrawn 2026-10-15: Built-in — Reddit galleries)* Archived.
- [X] T078 [P] [US4] Implement video player with DASH audio pairing in src/modules/listings/showImages/video.ts *(Withdrawn 2026-10-15: Built-in — Reddit video player)* Archived.
- [X] T079 [US4] Implement host-adapter interface + per-host opt-in (`requestPermissions`: `permissions.request` from a user gesture, `mediaHosts` true only after grant) in src/modules/listings/showImages/hosts/index.ts and src/entrypoints/background.ts; record each host origin and what is fetched in PRIVACY.md in the same change (constitution Principle IV) *(Superseded 2026-10-15: external hosts Deferred; archived)*
- [X] T080 [P] [US4] Port first external host adapters (Imgur, Streamable, YouTube embed) from RES lib/modules/hosts with attribution, and add their origins to `optional_host_permissions` in wxt.config.ts, in src/modules/listings/showImages/hosts/{imgur.ts,streamable.ts,youtube.ts}; add each host to PRIVACY.md in the same change *(Superseded 2026-10-15: external hosts Deferred; archived)*

---

## Phase 7: User Story 5 - Tag and highlight users (Priority: P2)

**Goal**: userTagger and userHighlight beside Reddit's author links (userInfo is Built-in). Reuse
logic from branch `parked/us5-classic-wip`.

**Independent Test**: quickstart scenario 9. A tag appears on every instance of a username;
ignored users are collapsed; moderators acting as moderators are highlighted.

### Tests for User Story 5

- [X] T081 [P] [US5] Unit tests for UserTag store (`username (lower-cased key)`, vote tally integer, ignored flag, never pruned) and tag rendering in tests/unit/user-tagger.test.ts
- [X] T082 [P] [US5] Browser test: tag beside the author link, tag editor popup, ignore collapses comment in tests/browser/us5-users.spec.ts

### Implementation for User Story 5

- [X] T083 [US5] Implement `userTagger` (tag text/color/link, vote tally auto-increment on delegated votes, ignore → collapse/hide per option, tag editor via hover framework) in src/modules/users/userTagger.ts
- [X] T084 [P] [US5] Implement `userHighlight` (moderator via the verified `is-mod-distinguished` contract, admin while unverified fails safe, friend via local friend list, tagged; Reddit marks OP) in src/modules/users/userHighlight.ts
- [X] T085 [P] [US5] Implement `userInfo` hover card (absorbs `redditUserInfo`; karma, cake day, bio, verified, tag shortcut, "info unavailable" on back-off) in src/modules/users/userInfo.ts *(Withdrawn 2026-10-15: Built-in — Reddit's user hover cards)*
- [X] T086 [US5] Research R7 follow-up: capture a thread with a mod-distinguished comment via tests/live/capture.ts, then promote or drop the `comment.distinguished` candidate in src/contracts/reddit.ts and update feature-matrix.md

---

## Phase 8: User Story 6 - Comment-thread power tools (Priority: P3)

**Goal**: Comment navigation, collapse, hide children, show parent, new-comment tracking, local
saves, context, subreddit hover info, and auto-hide.

**Independent Test**: quickstart scenarios 10–11. A revisited thread marks new comments and the
listing shows "(N new)". The navigator steps through OP comments. Saved comments are listed.

### Tests for User Story 6

- [X] T087 [P] [US6] Unit tests for ReadRecord tracking/pruning and new-comment computation in tests/unit/read-tracking.test.ts
- [X] T088 [P] [US6] Unit tests for comment navigator filters (OP, mod, admin, friend, tagged, popular, media) in tests/unit/comment-navigator.test.ts
- [X] T089 [P] [US6] Browser test: hide child comments toggle, show-parent popup, collapse persistence across reload in tests/browser/us6-comments.spec.ts

### Implementation for User Story 6

- [X] T090 [P] [US6] Implement `readComments` + `newCommentCount` (ReadRecord store, "(N new)" on listings, new markers in threads) in src/modules/comments/readComments.ts and src/modules/comments/newCommentCount.ts
- [X] T091 [P] [US6] Implement `commentNavigator` in src/modules/comments/commentNavigator.ts
- [X] T092 [P] [US6] Implement `commentQuickCollapse`, `hideChildComments`, `commentHidePersistor` in src/modules/comments/{commentQuickCollapse.ts,hideChildComments.ts,commentHidePersistor.ts} *(Amended 2026-10-15: `commentQuickCollapse` is Built-in; implement `hideChildComments` and `commentHidePersistor` only)*
- [X] T093 [P] [US6] Implement `showParent` and `context` in src/modules/comments/showParent.ts and src/modules/comments/context.ts *(Amended 2026-10-15: `context` is Built-in; implement `showParent` only)*
- [X] T094 [P] [US6] Implement `saveComments` (SavedComment snapshot, saved list view) in src/modules/comments/saveComments.ts
- [X] T095 [P] [US6] Implement `commentStyle`, `commentDepth`, `commentSortBy` (URL `?sort=`, C and N) in src/modules/comments/{commentStyle.ts,commentDepth.ts,commentSortBy.ts} *(Amended 2026-10-15: `commentStyle` is Built-in; implement `commentDepth` and `commentSortBy` only)*
- [X] T096 [P] [US6] Implement `neverEndingComments` (comment-tree partials only) in src/modules/comments/neverEndingComments.ts *(Withdrawn 2026-10-15: Built-in — Reddit's "more replies")*
- [X] T097 [P] [US6] Implement `autoHide`, `tableTools`, `spoilerTags` in src/modules/listings/autoHide.ts, src/modules/comments/tableTools.ts, src/modules/comments/spoilerTags.ts *(Amended 2026-10-15: `spoilerTags` is Built-in; implement `autoHide` and `tableTools` only)*
- [X] T098 [P] [US6] Implement `subredditInfo` hover card (description, weekly visitors, weekly contributions, join via delegated `shreddit-join-button`) in src/modules/listings/subredditInfo.ts *(Withdrawn 2026-10-15: Built-in — Reddit's community hover cards)*

---

## Phase 9: User Story 7 - Signed-in actions (Priority: P3)

**Goal**: Keyboard vote and save that press Reddit's own controls (Reddit's controls and composer
are otherwise used directly). Success is shown
only after confirmation, and drafts are preserved on failure. Includes markdown toolbar and
preview.

**Independent Test**: quickstart scenarios 12–13. Signed in, votes and replies persist after
reload. Signed out, arrows say sign-in is required and scores do not change.

### Tests for User Story 7

- [X] T099 [P] [US7] Unit tests for ActionApi state machine (`ok` only after observed confirmation; `signed-out|not-found|timeout|rejected`; draft kept unless ok; no double submit after unconfirmed reply) in tests/unit/actions.test.ts
- [X] T100 [P] [US7] Browser tests with a fixture that simulates Reddit's lazy vote buttons and rejecting composer in tests/browser/us7-actions.spec.ts

### Implementation for User Story 7

- [X] T101 [US7] Implement ActionApi (vote/save/hide/reply via bridge `native.click`/`composer.*`, confirmation observers, timeouts) in src/core/actions.ts
- [X] T102 [US7] Implement classic vote arrows, save/hide links, and reply form wired to ActionApi (signed-out state, "may not have gone through" message) in src/modules/actions/actionsUi.ts *(Superseded 2026-10-15: Reddit's own controls are used directly. Replaced by T131)*
- [X] T131 [US7] Keyboard vote/save on the selected item via ActionApi pressing Reddit's own controls; signed-out says sign-in is required; success only after Reddit's state confirms it, in src/modules/actions/keyboardActions.ts *(Done 2026-10-15 for voting (a/z, again to clear), confirmed against Reddit's aria-pressed state; keyboard save is not offered until Reddit's save control is captured signed in. Verified live signed in 2026-10-15 on a post: upvote, persist, clear, persist; comment voting Infeasible (closed shadow root), see research R10)*
- [X] T103 [P] [US7] Implement `voteEnhancements` (score colouring, upvote ratio) in src/modules/actions/voteEnhancements.ts *(Amended 2026-10-15: upvote ratio in the `credit-bar` slot only; vote buttons are inside closed components)* *(Done 2026-10-15: upvote ratio from the post's `upvote-ratio` attribute, shown only where a post carries it (not yet captured on a live listing); score colouring is Infeasible, the score is inside Reddit's closed vote component)*
- [X] T104 [P] [US7] Implement `commentTools` (markdown toolbar) and `commentPreview` (live preview with a sanitized markdown renderer) in src/modules/actions/commentTools.ts and src/modules/actions/commentPreview.ts *(Withdrawn 2026-10-15: Built-in — Reddit's composer has formatting and preview)*
- [X] T105 [P] [US7] Implement `noParticipation` warning in src/modules/actions/noParticipation.ts *(Withdrawn 2026-10-15: Infeasible — `np.reddit.com` redirects to www and leaves no host, referrer or URL marker to key on; REScue's content script does not run on np.)*

---

## Phase 10: User Story 8 - Appearance & tweaks (Priority: P4)

**Goal**: Themes incl. night, custom CSS, local dates, username hiding, shortcut bar, and
miscellaneous tweaks.

**Independent Test**: quickstart scenario 14. Night mode is applied from first paint with text
contrast ≥4.5:1. Custom CSS applies. Username is masked. The shortcut bar shows the chosen subs.

### Tests for User Story 8

- [X] T106 [P] [US8] Contrast test over every theme palette (all text/background pairs ≥4.5:1) in tests/unit/themes.test.ts *(Withdrawn 2026-10-15: Built-in — Reddit's dark mode)*
- [X] T107 [P] [US8] Browser test: theme applied at document_start (no light flash), username hiding on classic and native in tests/browser/us8-appearance.spec.ts *(Amended 2026-10-15: username hiding on Reddit's layout only; no theme test)*

### Implementation for User Story 8

- [X] T108 [P] [US8] Implement themes (classic, slate, sepia, night, carbon ported from Sheddit themes) and `nightMode` module in src/styles/themes.css and src/modules/appearance/themes.ts *(Withdrawn 2026-10-15: Built-in — Reddit's dark mode)*
- [X] T109 [P] [US8] Implement `stylesheet` (user custom CSS, C and N) in src/modules/appearance/customCss.ts
- [X] T110 [P] [US8] Implement `localDate`, `usernameHider`, `userbarHider` in src/modules/appearance/{localDate.ts,usernameHider.ts,userbarHider.ts} *(Amended 2026-10-15: `userbarHider` is Built-in; implement `localDate` and `usernameHider` only)*
- [X] T111 [P] [US8] Implement `subredditManager` shortcut bar (local list, import subscriptions when signed in, C and N) and `multiredditNavbar` (custom feeds) in src/modules/appearance/subredditManager.ts and src/modules/appearance/multiredditNavbar.ts *(Amended 2026-10-15: `multiredditNavbar` is Built-in; implement `subredditManager` only)*
- [X] T112 [P] [US8] Implement `pageNavigator`, `logoLink`, `searchHelper`, `disableChat`, `styleTweaks` in src/modules/appearance/{pageNavigator.ts,logoLink.ts,searchHelper.ts,disableChat.ts,styleTweaks.ts}
- [X] T113 [P] [US8] Implement `showKarma` (own karma via hovercards for session username) in src/modules/appearance/showKarma.ts *(Withdrawn 2026-10-15: Built-in — Reddit's user menu)*

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T114 [P] Research R6 follow-up: capture the signed-in header unread badge via tests/live/capture.ts; if stable, add contract `inbox.badge` and implement `orangered` in src/modules/users/orangered.ts, else leave Deferred with a reason in feature-matrix.md *(Withdrawn 2026-10-15: Built-in — Reddit's inbox badge)*
- [X] T115 [P] Audit PRIVACY.md against every src/core/net.ts call site and granted host; implement SC-006 test comparing hosts contacted on 5 pages with REScue disabled vs enabled (default settings), failing if any host appears only in the enabled run, in tests/browser/privacy.spec.ts
- [X] T116 [P] Performance pass: profile 5,000-comment fixture and a 500-post endless listing; assert ≤100 ms main-thread work per batch and ≤200 ms filter+render (SC-004) in tests/browser/perf.spec.ts
- [X] T117 [P] Add mutation spot-check script that reintroduces known Sheddit-documented bugs (body not scoped, hover partial driven as pagination, composer empty counted as success) and proves suites fail, in tests/mutate.ts
- [X] T118 Reconcile feature-matrix.md against src/modules/index.ts (every registered module has `resId` and the matrix status matches); add an automated check in tests/unit/feature-matrix.test.ts
- [X] T119 [P] Optional RES backup importer (user tags + filteReddit only, reports skipped items) in src/modules/core/resImport.ts
- [X] T120 Run `npm run verify:live` against www. and sh.; record `verifiedAt` dates in src/contracts/reddit.ts *(Run 2026-10-15 on www. and sh.: all contracts ok, logged out and — via `LIVE_PROFILE` — signed in; the signed-in run found a second credit-bar design, now supported)*
- [ ] T121 Run all quickstart.md validation scenarios 1–15 on Chrome and Firefox and record results in specs/001-rescue-foundation/checklists/release.md *(Chrome run recorded 2026-10-15 in checklists/release.md; Firefox subset run 2026-10-16 (logged out: install, menu/console themes, filter, j/k, tag, inline media, lean chips, promoted, export; all pass on LibreWolf 158 and Firefox 152); open: Firefox signed-in and remaining scenarios, custom feed not run; search results enhanced since T133)*
- [X] T133 Search results (FR-001): capture the live structure of Reddit's search page, verify `search.*` contracts, parse results into the Post model (src/model/search-post.ts), feed them through the pipeline and NativeAdapter so filteReddit, user tags, keyboard navigation and localDate work there; fixtures, unit and browser tests *(Done 2026-10-15; verified live signed in on www. and sh., research R19)*
- [X] T134 RES UI parity (ui-parity.md batches 0–6): inline filter menu, filter power switch / reasons / placeholder / comment rules / more rule types; user-tagger presets, preview, manager, up/down counts and arrow-click counting; gear menu, notices, command-line registry and RES commands; link numbers and RES keys; shortcut-bar editing; comment-tool UI; settings-console polish *(Merged 2026-10-15; perf regression on 5,000-comment threads being fixed; live checks listed in ui-parity.md)*
- [X] T135 UI polish from user reports and the live smoke test: tool strip reduced to the REScue button (navigator hidden by default, other items in the menu), one non-overlapping bottom-right stack, popups flip and clamp inside the viewport, themed filter banner, REScue follows Reddit's `theme-dark` (settings console included), contrast ≥4.5:1, live module disable, wording fixes (open: comment-meta links clip at 820px, smoke #14)
- [X] T136 [US4] Hide inline media (RES showImages): collapse `post-media-container` behind "show image/video/gallery", menu toggle, `x`/Shift+X, scope and type options, per-subreddit, remember expanded, opt-in download blocking via optional declarativeNetRequest (constitution 2.1.0)
- [X] T137 [US7] Comment actions via the open action-row root (R20): a/z/Shift+A/Shift+Z on comments, `r` reply, `e` edit; vote tally from comment arrow clicks; comment score filters, locked filter, RES score colouring as REScue chips
- [X] T138 Same-origin JSON reads (constitution 2.1.0 Principle V): thread subscriptions with new-comment alerts, "My Subreddits" dropdown and import in the shortcut bar, import Reddit blocked users as ignored
- [X] T139 Header REScue button, tag/ignore/highlight in post authors' hover cards, feed pause and click-to-load, CSS hooks, links in new tab, userHighlight extras, x-post links, autoHide by time on screen, remaining keys, `Alt+/` focus fix
- [X] T140 Rerun tests/live/smoke-live.ts (signed in, both themes, 1280 and 820) after T135–T139 and record the before/after in checklists/release.md
- [X] T141 Hide promoted posts (opt-in, cosmetic only; REScue extra, not RES parity)
- [X] T142 Neutrality filter (audience-partisanship scores, Robertson et al. 2018, CC0; left/right off/min/mid/max; REScue extra)
- [X] T143 Audience-lean chips on link posts (blue left → grey → red right)
- [X] T144 Gap build F: filteReddit custom conditions and browse cases, comment navigator custom/highlighted/popular conditions, nav / tag / fl / fp / post commands
- [X] T122 Build and zip store packages (`npm run build && npm run zip`) and prepare Chrome Web Store / AMO listing text in docs/store-listing.md
- [X] T145 Media viewer, sizing and media keys (width/height limits, text caps, filmstrip, plain video player, picture-link expandos, size/move keys, F filter key)
- [X] T146 Comment and appearance tweaks (H1): comment boxes, selected-entry fill and line, comment permalink depth, default context, scroll on collapse, jump to comment box, post title case, long-link truncation, scrollbar, username reveal on hover, user highlight colours, show karma
- [X] T147 Gap build H2: shortcut bar options (per account, delays, last visited, RandNSFW), hover settings, dashboard panel, feed pause markers and remembered pause, notice fade, update notice and tips, troubleshooter buttons, No popups preset, sync restore prompt, custom profile page, profile pages menu, user-in-subreddit search, hide author card, Konami code
- [X] T148 Fixes from the live check of T144–T147: feed pause holds the loader (hidden, id set aside) so nothing loads it, narrowed loader selector, page counts and end-of-feed notice; original picture size from /api/info.json; stopped rewriting ?depth= and ?context= on comment links (Reddit ignores them; context module removed); innermost-only comment hover border; notices above the settings console; live updates for comment collapse and selected-entry options; keyboardNav nonLinearScrollStyle; smoke harness fixes; notice close-delay wording
- [X] T149 Retire commentDepth (Reddit ignores ?depth=)
- [X] T151 REScue button chips (one `.rescue-btn` look for every control), page-level single-instance guard (newest instance wins), idempotent decorations
- [X] T152 Settings console redesign like RES: ten RES categories (About, My account, Users, Comments, Submissions, Subreddits, Appearance, Browsing, Productivity, Core) that expand to their modules with on/off words, one page per module and a category overview, a prominent "Search all settings" box with `/` and Ctrl+F, grouped search results that open the option, and an always-visible "Changes save automatically" line with a status
- [X] T153 Hide inline media in comments: the switch hides comment pictures/GIFs/videos behind per-item words (early stylesheet, no flash), post media moved to option collapsePostMedia (migration v2 to v3)
- [X] T154 Old Reddit look skin (opt-in CSS restyle of feeds and threads)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → **US1, US2** (done).
- **Native pivot (Phase 4b)**: T123 before everything after it; T124 before any module that
  decorates posts or comments (T127, T129, T130, US5, US6, T103).
- **Polish (Phase 11)**: after the desired stories.

### User Story Dependencies

- **US3 (P2)**: T123; T127 depends on T029 keys and the native adapter.
- **US4**: withdrawn (Built-in).
- **US5 (P2)**: T124 (author-link anchor); T030 hover framework for the tag editor.
- **US6 (P3)**: T124 (`commentMeta` slot).
- **US7 (P3)**: T033/T034 bridge, T127 selection. T083's vote tally integrates with T101 (optional).
- **US8 (P4)**: T123 only.

### Within Each Story

Tests first (must fail) → models/stores → module logic → UI wiring → story checkpoint.

### Parallel Opportunities

- Setup: T003–T007 in parallel.
- Foundation tests T009–T015 in parallel. Implementation T017–T022 and T028–T031 in parallel after
  T016.
- After T124, US3, US5, US6 and US8 can proceed in parallel; they touch disjoint module files.
- Inside stories, every task marked [P] touches its own file.

---

## Parallel Example: User Story 6

```bash
Task: "Unit tests for ReadRecord tracking in tests/unit/read-tracking.test.ts"
Task: "Unit tests for comment navigator filters in tests/unit/comment-navigator.test.ts"
Task: "Implement commentNavigator in src/modules/comments/commentNavigator.ts"
Task: "Implement saveComments in src/modules/comments/saveComments.ts"
Task: "Implement showParent in src/modules/comments/showParent.ts"
```

## Parallel Example: Foundation

```bash
Task: "Post model parser in src/model/post.ts"
Task: "Comment model parser in src/model/comment.ts"
Task: "h() builder and formatting in src/core/dom.ts"
Task: "Key dispatcher in src/core/keys.ts"
Task: "Hover popup framework in src/core/hover.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2) — done

1. Phase 1 Setup → Phase 2 Foundational → US1 → US2 (release 0.1).
2. Native pivot (Phase 4b, 2026-10-15): remove classic, add native decorations.

### Incremental Delivery

- 0.2: US3 + US5 (keyboard over Reddit's items; user tags and highlights)
- 0.3: US6 (comment tools)
- 0.4: US7 (keyboard vote/save, flagged experimental until live-verified)
- 0.5: US8 + Polish

### Delegation Note

Implementation tasks go to Sonnet subagents with self-contained briefs; Claude (main session)
designs, reviews, runs every gate and commits. Doc sweeps and capture write-ups can go to the GLM
runner (`~/.claude/bin/glm-run.ps1`). Never give two writers overlapping files.

Keep quality- and security-critical tasks with Claude: bridge (T033), ActionApi (T101), hovercards
(T032), sanitizer (T018), native decoration contracts (T124).

---

## Notes

- [P] = different files, no dependency on incomplete tasks.
- Commit after each task or logical group. Stop at any checkpoint to validate a story
  independently.
- Any change to src/contracts/reddit.ts requires updated fixtures and a live-contract run
  (constitution workflow gate).
