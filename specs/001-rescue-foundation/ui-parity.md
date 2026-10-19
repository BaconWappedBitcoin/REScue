# RES UI parity — gap audit and build batches (2026-10-15)

**Why**: the user wants UI feature parity with RES, not only module-level parity (for example,
filtering inline as RES does, without opening settings). A read-only audit compared every visible
RES control in `_ref/Reddit-Enhancement-Suite/lib/modules` with REScue's source. The matrix
(`feature-matrix.md`) stays the module-level record; this file tracks control-level parity.

Status key:
- **Have**: REScue has the control.
- **Partial**: some of it is there.
- **Missing**: it can be built.
- **Infeasible**: it can't be built on modern Reddit (reasons below).
- **Built-in**: Reddit already provides it.

## Build batches

| Batch | Scope | Files (disjoint unless noted) | State |
|---|---|---|---|
| 0 | Inline filter menu (⊘ per post: filter subreddit / user / domain), subreddit-page "+ filter" toggle, Undo | `modules/listings/filteReddit/*` | merged 1938687 (T132) |
| 1 | Filter power switch (`fp`), visible match-reason chip, "everything filtered" notice, placeholder mode, comment filters, more post rule types (score, comment count, post type, locked/spoiler/visited, user tag), NSFW allow-list | `filteReddit/*` (after batch 0) | merged (batch 1) |
| 2 | User tagger: 21 colour presets + live preview, preset tags, Enter submits, source URL auto-filled with open link, separate up/down counts, vote-weight colouring, tagged-users manager panel, no tag button on own name, truncate/icon options, count clicks on Reddit's post arrows; highlight self | `modules/users/*` | merged 060a4df |
| 3 | Gear dropdown menu (`addMenuItem` API) with settings search, command line, custom-toggle switches, NSFW toggle, About; notices with module header + settings link, per-type mute, cooldown, pause on hover; theme variables for REScue popups; command-line registry and RES commands (`me/*`, `m/`, `u/x/m/y`, sort `/t week`, `s`, `sr`, `?` list, Shift/Alt+Enter new tab) | `layout/native/toolbar.ts`, `core/{notices,hover,types}.ts`, `modules/core/*` | merged 24ac390 |
| 4 | Keyboard: link-number overlay (keys 1–9/0, `[n]` command), Enter toggles comment collapse, undo move, Alt+j parent-sibling, new-tab variants, `y` permalink, go-mode extras (modmail, random), focus search, Shift+a/z no-toggle vote, move down after vote, scroll style, selectedEntry options | `listings/keyboardNav/*`, `layout/native/selection*.ts`, `modules/actions/keyboardActions.ts` | merged (batch 4) |
| 5a | Shortcut bar: in-bar edit/delete, add form, drag reorder, sort menu, scroll arrows, group (`a+b`) dropdown, more static links, add/remove toggle | `modules/appearance/subredditManager*` | merged 7d132dc |
| 5b | Comment tools: navigator position "3/12", close/toggle (`N`), more categories (me, images vs videos, all, answered by OP), skip-read; show-parent chain with goto; nested hide-children; "save-RES"/"saved-RES" wording plus a one-time explainer; "Hide read comments" notice; per-subreddit depth; singleClick `[l=c]` and options; hide-children / show-parent keys | `modules/comments/*`, `listings/browsing.ts` | merged (batch 5b) |
| 6 | Settings console: advanced-options toggle, default value + reset, option keys shown, table row reorder, About links | `ui/settings-console/*` | merged 5463019 |

## After the merge (2026-10-15)

All batches are merged on 001-rescue-foundation, and the unit, lint, type and browser suites pass.
Two tests were fixed after the merge:
- The gear now opens a menu, so console tests go through it.
- The Hide NSFW toggle applies live.

Open items:
- **Performance.** The 5,000-comment perf budget regressed with the added per-comment UI and is
  being fixed.
- **Live checks pending.** Each needs a live pass on real Reddit (signed in):
  - link-number badges in real bodies
  - clipboard keys
  - `Alt+/` search focus
  - the gear menu at narrow widths
  - shortcut-bar drag in Firefox
  - counting clicks on Reddit's own post arrows
  - `?depth=`
  - `mm` / `me/upvoted` URLs
  - the parent-chain popup and nested hide-children toggles in Reddit's summary layout
- **Skipped as infeasible**, with reasons in the module descriptions:
  - comment minimum-score filter
  - "locked" post filter (no verified attribute)
  - "visited" filter (would need history)

## Infeasible on modern Reddit (recorded with reasons)

| Item | Reason |
|---|---|
| Voting on comments; "upvoted" navigator category; vote tally from comment clicks | Comment vote buttons are in `shreddit-comment`'s closed shadow root (verified signed in) |
| Score colouring, highlight controversial | The score is drawn inside the closed vote component |
| Tag button inside Reddit's user hovercard | Reddit-owned overlay with no anchor REScue can verify |
| Reply (`r`) / edit (`e`) from the keyboard | The comment action row is likely in the closed shadow root (to probe). Post save/hide (`s`, `h`) are deferred until Reddit's overflow menu is captured signed in |
| Thread subscriptions ("My subscriptions") | Needs background fetches of thread data through APIs REScue does not use |
| "My Subreddits" dropdown and subscription import | Left-nav markup not captured, and the subscription data would need an API |
| Sync filters with Reddit's own filters | Authenticated Reddit API calls |
| Expando keys (x, image size, gallery, mute) | Reddit shows media inline, and its controls are in shadow roots |
| Next/previous page keys | Built-in: Reddit loads more as you scroll |
| Alumni highlight, gilded category | Reddit no longer has these markers |
| Developer commands (`XHR`, `RESStorage`, …); announcements biff; donate item | RES-internal |
| Gear inside Reddit's header bar | No verified header anchor; the REScue tool strip carries it instead |
