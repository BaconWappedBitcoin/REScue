# Phase 0 Research: REScue Foundation

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-15

Each item gives a Decision, Rationale, and Alternatives. "Measured" means a live HTTP probe run on
2026-10-15, logged out, with a desktop Chrome user-agent. "Inherited" means taken from Sheddit's
live-verified `contracts.js` (2026-08 → 2026-09). Probe artefacts are not committed.

---

## R1. Extension framework & build

- **Decision**: TypeScript 5.x (strict) built with **WXT** (Vite-based MV3 framework). WXT produces
  Chrome MV3 and Firefox MV3 builds from one source and handles manifest generation and per-browser
  zips. Content-script UI uses plain DOM through a small `h()` builder. The settings console and
  options page use **Preact**, mounted in a shadow root.
- **Rationale**: 66+ modules need types, a module registry, and a real bundler. WXT removes
  hand-maintained per-browser manifests (Sheddit maintains `firefoxManifest()` by hand). Rendering
  hundreds of rows has to stay cheap, which rules out a virtual DOM in hot paths. Preact is only
  used where forms make it worthwhile.
- **Alternatives**: Plain JS plus a custom build script (the Sheddit model) does not scale to 66
  modules with typed options. Plasmo is React-centric and heavier. A raw esbuild setup means
  rebuilding WXT's manifest and zip logic.

## R2. Rendering strategy for the classic layout

- **Decision**: Adopt Sheddit's "rebuild, don't restyle" pipeline. Read `shreddit-post`,
  `shreddit-comment`, and `shreddit-profile-comment` attributes into typed models, render
  REScue-owned markup into a root container, and hide the native subtree with one stylesheet
  injected at `document_start`. A content-aware gate removes the hiding if rendering has not
  succeeded by a deadline.
- **Rationale**: Inherited facts. Posts carry their full model as light-DOM attributes, and visual
  sub-components sit inside shadow roots that page CSS cannot reach. The action bar hydrates lazily,
  and comment threading is reliable only via `depth`.
- **Alternatives**: Restyling native DOM fails at shadow roots and breaks on every deploy.
  Reparenting native nodes breaks their hydration JavaScript.

## R3. Pagination (Never Ending Reddit / Comments)

- **Decision**: Drive `faceplate-partial[loading="programmatic"]` by calling its public
  `loadContent()` from the single main-world bridge script. Exclude partials whose `src` contains
  `hover-card`. Comment pagination is scoped to partials inside `shreddit-comment-tree`.
- **Rationale**: Inherited. These partials do not self-trigger once the native feed is hidden.
  Hover-card partials share the same element type and loading mode, and firing one stalls paging.
- **Alternatives**: Scroll emulation was measured not to work. Fetching `/svc/shreddit/feeds/*`
  directly would mean depending on undocumented query parameters.

- **Live findings (2026-10-15, logged out, REScue smoke test)**:
  - Reddit server-renders only 3 posts per listing. With the native feed hidden, its own loader never
    fires, so the classic layout fills the first page itself (to at least 25 posts) with that loader.
  - The subreddit continuation loader (`/svc/shreddit/community-more-posts/...`) sits last in the
    feed, after posts and ads, and **ignores `loadContent()` calls made right after load**. The
    first-page fill therefore waits for parsing to finish, then retries a no-op call after a 1 s pause.
  - Logged-out "hot" order is not stable between loads.
  - Reddit may serve a JS interstitial that the browser passes on its own and navigates past;
    REScue never interacts with it.

## R4. User hover card data (userInfo, redditUserInfo, showKarma) — un-deferred

- **Decision**: Fetch `GET /svc/shreddit/user-hover-card/{username}` (same origin, with
  credentials) with header `Accept: text/vnd.reddit.partial+html, text/html;q=0.9`. Parse the
  fragment with `DOMParser`, which does not execute scripts.
  - `time[data-testid="cake-day"]@datetime` gives the cake day (ISO 8601).
  - `[data-testid="karma-number"]` occurs twice, in order: post karma, then comment karma. Each is
    paired with its label text, and the parser matches on the label rather than the position.
  - `[data-testid="nameplate"]` gives the display name; the bio is the first whitespace-normal
    `<span>` after the nameplate block, which is optional.
  - `[data-testid="verification-icon"]` gives the verified flag; `[data-testid="follow-button"]`
    shows that following is possible.
- **Measured**: Returns 200 with an 8,186-byte fragment for `spez`. Without the Accept header it
  returns a 316 KB full page shell, with the card at byte offset 308,124. A nonexistent user returns
  200 with no `user-hover-card` element, so a missing card means "not found / suspended".
  `sh.reddit.com/svc/...` redirects to `www.reddit.com`.
- **Usage rules**: Fetch only after a hover delay (default 500 ms), and only one request in flight
  per username. Cache results for 30 minutes in memory, with a session-storage LRU of 500 entries.
  On 429 or 5xx, back off globally for 5 minutes and show "info unavailable". Never prefetch for a
  whole page.
- **Fallback**: If the partial Accept header stops returning a fragment, fetch the full page and
  parse from `[data-testid="user-hover-card"]`. This costs about 58 KB compressed per hover, so the
  cache matters even more.
- **Gaps vs RES**: The user's account age comes from the cake day. The "is friend" and "is moderator
  of this sub" lists are not on the card. Friend status falls back to the local friend list. RES's
  per-user subreddit/link stats are dropped, and the matrix marks them Adapted.
- **Alternatives**: `/user/{name}/about.json` measured **403** logged out (the anonymous JSON API is
  gated). Signed-in same-origin JSON was not measured and is fragile, so it is rejected as the
  primary source. Scraping the profile page costs a full page load per hover and is rejected.

## R5. Subreddit hover card data (subredditInfo) — un-deferred

- **Decision**: `GET /svc/shreddit/community-hover-card/{subreddit}` with the same Accept header,
  parser, and cache rules as R4.
  - The description is the first `<p>` in the card.
  - The two `faceplate-number@number` values are paired by label: "Weekly visitors" and "Weekly
    contributions" (`[data-testid="community-hover-card:active-count"]`).
  - `shreddit-join-button` is present, and its state reflects whether the user has joined.
- **Measured**: 200, 2,745-byte fragment for `programming` (202,086 weekly visitors, 1,921 weekly
  contributions). `/r/{sub}/about.json` returned **403**.
- **Gaps vs RES**: There is no subscriber count, created date, or NSFW flag. RES's "subscribers"
  becomes "weekly visitors", and the NSFW flag comes from post attributes where available. The
  "subscribe" control delegates to the card's own `shreddit-join-button` (Principle V).
- **Alternatives**: The subreddit sidebar (`#right-sidebar-container`) is only present on that
  subreddit's own page, so it does not help hovers on `/r/all`.

## R6. Own karma (showKarma) and unread count (orangered)

- **Decision**: Get own karma by applying R4 to the signed-in username, which is read from
  `shreddit-app > after-login-toast-dispatcher[username]` (inherited). Unread inbox and notification
  counts remain **Deferred**: the header badge markup has not been captured signed in. The task is
  to capture it with the live-contract tool while signed in, then decide.
- **Rationale**: Karma reuses a verified source. The header is a signed-in-only, unmeasured
  surface.

## R7. Comment author roles (userHighlight: OP / mod / admin)

- **Decision**: Derive OP by comparing the comment's `author` with the post's `author`; this is
  reliable. Moderator and admin distinction is **unverified**: neither Sheddit's contracts nor this
  probe recorded a distinguished attribute. Add candidate contracts (`distinguished`,
  `author-is-moderator`, or the `distinguished` value in a comment's JSON-mirroring attributes) as
  *optional*, and confirm them with a live-contract run on a thread that has a mod-distinguished
  comment. Until confirmed, mod and admin highlighting is off and the matrix notes this.
- **Resolved 2026-10-15 (T086, live, logged out)**: an AutoModerator comment in r/science carried the
  boolean attribute `is-mod-distinguished`; an ordinary comment in the same thread did not. The
  contract is now verified for moderators. Admin uses the presence attribute `is-admin-distinguished`
  by analogy, unverified and fail-safe (absence means "not admin"). The same capture showed Reddit
  marks pre-collapsed comments (here AutoModerator's) with a `collapsed` attribute, useful for US6.
- **Rationale**: Principle II: do not highlight on a guess.

## R8. Raw markdown (sourceSnudown) — stays Deferred

- **Decision**: Keep it Deferred. Comment bodies arrive as rendered HTML (`[slot="comment"]`), and
  no raw-markdown attribute is known. Converting HTML back to markdown is lossy. Revisit if a source
  is found, for example the edit composer for the user's own comments.

## R9. sh.reddit.com status

- **Decision**: Match `sh.reddit.com` in the manifest, but treat it as an alias of
  `www.reddit.com`. One contract set covers both, and the live-contract suite runs against both
  origins.
- **Measured**: Logged out, `sh.reddit.com/r/programming/` and `sh.reddit.com/svc/...` both
  redirect to `www.reddit.com`. Signed-in behaviour may differ, because historically sh. was the
  opt-in shreddit beta. Any measured divergence becomes a per-host contract override.

## R10. Signed-in actions (vote / save / hide / reply)

- **Decision**: Delegate actions to Reddit's own controls. The bridge clicks the native control
  inside the hidden native subtree, which is kept laid out (hidden by clipping and opacity, not
  `display:none`) so lazily hydrated vote buttons exist. Success is confirmed by observing Reddit's
  state change before REScue updates its UI. Reply drafts are inserted into Reddit's composer, and
  only the posted comment appearing counts as success.
- **Rationale**: Inherited, and painful: Sheddit 0.45–0.53 documents how each shortcut failed
  (pre-hydration buttons, a falsely confirmed empty post, doubled drafts). Same-origin GraphQL or
  API calls are rejected for 1.0 because they are undocumented, need CSRF and token handling, and
  approach Principle V.
- **Alternatives**: OAuth API access needs app credentials and tokens, which Principle V
  prohibits.

- **Live result (2026-10-15, signed in, www.)**: keyboard voting on a post passed end to end on a
  thread page. `a` upvoted through `button[upvote]` in the post's open shadow root, and the vote
  survived a 6 s wait and a reload. `a` again cleared it, and that also survived a reload. No REScue
  notice was shown, as intended. Reddit sends votes as `POST /svc/shreddit/graphql`.
- **Limitation found**: `aria-pressed` is optimistic UI. In an earlier run that voted on the same
  post seconds after clearing it, the button flipped but the vote was gone after a reload. Reddit
  appears to drop rapid repeat votes without reverting the button. "Confirmed" therefore means
  "Reddit's own UI shows it", not "the server accepted it". This is the same signal a mouse user
  sees.
- **Comments**: comment vote buttons sit in `shreddit-comment`'s closed shadow root. No vote button
  for a comment exists in any light DOM or open shadow root, so keyboard voting on comments is
  Infeasible (Principle I).

## R11. Keyboard handling vs Reddit's own shortcuts

- **Decision**: One capture-phase `keydown` listener on `window`. It ignores events whose composed
  path includes an editable element, including Reddit's rich-text editor inside shadow roots. When
  REScue handles a key it calls `stopImmediatePropagation()` and `preventDefault()`. Keys typed in
  REScue's own inputs are stopped from reaching Reddit's handlers.
- **Rationale**: Inherited bug: Reddit's shortcut handler treated keys typed in Sheddit's reply box
  as commands (`h` hid the post).

## R12. Storage

- **Decision**: Use `storage.local` with the `unlimitedStorage` permission for all data. Use
  `storage.sync` only for the settings profile, chunked under the sync quota (about 8 KB per item,
  about 100 KB total). Tags, filters, and read history are local-only, and the export file carries
  everything. Every stored document carries a schema version, and migrations run at startup.
  Read-tracking is pruned LRU when it exceeds 50,000 threads or 90 days, whichever comes first.
- **Alternatives**: IndexedDB is more capable but needs more code, and RES-scale data (tens of
  thousands of tags) fits in `storage.local`. Revisit if profiling shows problems.

## R13. External media hosts (showImages)

- **Decision**: Reddit-hosted media (`i.redd.it`, `preview.redd.it`, `v.redd.it`, galleries) uses
  data already in the page. External hosts (Imgur, Gfycat successors, Streamable, YouTube embeds,
  etc.) are declared as `optional_host_permissions` and requested per host when the user enables
  it, mirroring RES's `requestPermissions`. With default settings there are zero external requests
  (SC-006).
- **Reuse**: Port host matchers from RES `lib/modules/hosts/` selectively, with GPL attribution.

- **Measured 2026-10-15 (Reddit's Content-Security-Policy on www.reddit.com)**: `img-src 'self' data:
  blob: https:` (any https image host), `frame-src` includes www.youtube.com,
  www.youtube-nocookie.com, player.vimeo.com, streamable.com and redgifs.com, and `media-src` allows
  only `*.redd.it`. **Outcome**: host adapters show images and official embeds inside the page and make
  no API calls, so REScue requests **no** host permissions (least privilege); "opt-in" is a per-host
  setting, off by default. Video files from other hosts (Imgur .gifv/.mp4) cannot play inline and stay
  links; Imgur albums need its API and stay links.

## R14. Code reuse and licensing

- **Decision**: Licence REScue under GPL-3.0-or-later. Port, rather than vendor, the specific logic
  from Sheddit (contracts, model, paginator, gate, media/DASH pairing) and RES (filter matching,
  keyboard command table, user-tagger data model, host matchers). Each ported file keeps an
  attribution header naming the upstream file and copyright. Neither project is forked wholesale,
  because REScue's module system and TypeScript structure differ.

## R15. Testing strategy

- **Decision**:
  - **Unit**: Vitest with happy-dom, covering models, filters, parsers, and the module registry.
  - **Fixture**: Synthetic pages built from captured live structure, including both comment-nesting
    orders (Sheddit's lesson).
  - **Real browser**: Playwright with the packed Chromium extension (gate, layout geometry,
    keyboard), plus a Firefox smoke suite.
  - **Live contracts**: a Playwright script that visits real `www.` and `sh.reddit.com` pages and
    reports per-contract hit rates.
  - **Mutation spot-checks**: reintroduce fixed bugs to prove the tests catch them.
- **Note**: The live-contract run uses a real browser profile. It must not solve bot challenges
  programmatically. If served a challenge, it reports "blocked" rather than failing contracts.

## R16. Firefox differences

- **Decision**: The main-world bridge uses MV3 `world: "MAIN"` content scripts on Chromium. On
  Firefox it uses `scripting.executeScript({world: "MAIN"})` registration or `wrappedJSObject` as WXT
  supports. CI runs the Firefox smoke suite on every PR.

---

## R17. Native decoration anchors (live, 2026-10-15)

**Decision**: REScue places its elements at these anchors, all in Reddit's light DOM. They were
verified on www. and sh. using listings (`/r/science/`) and threads.

| Placement | Anchor | Why |
|---|---|---|
| Post author extras | After the post's `[slot=authorName]` wrapper | The link sits in a block-level `faceplate-tracker`, so anything placed after the link wraps onto a new line |
| Post tagline (`[l+c]`, subreddit tags) | After `faceplate-timeago` in the post's own credit bar | The credit bar is a two-group `justify-between` row, and a third child reflows it |
| Post title extras | After Reddit's own `[slot=title]` element; the node copies `slot` only when that element is a direct child of the post | On listings the title sits inside a wrapper |
| Comment author extras | After the comment's own author link in its `commentMeta` | Renders inline |
| Comment tagline | Inside the comment's own `commentMeta` element | |

**Correction**: an earlier probe concluded that elements slotted onto `shreddit-post`
(`slot="credit-bar"`) render. They do on thread pages. On listings the post's shadow root has no
`credit-bar` or `title` slot, so slotted children never render. A contract probe that only checks
that Reddit's own elements exist (T125, first version) cannot catch this. Live checks must measure
the rendered box of REScue's own node and compare screenshots.

## R18. Decomposing RES with REA (2026-10-15)

**Decision**: Use REA (`morluto/rea`, `npx rea-agents analyze-javascript-application <dir> --json`)
for a static import graph of RES before porting a module. The per-module map is in
[res-dependencies.md](./res-dependencies.md).

**Findings**:
- RES is Flow-typed. On the raw clone, REA failed to parse 82 of the 83 `lib/modules/*.js` files.
  After stripping types into a scratch copy (`npx flow-remove-types --pretty --out-dir`), it
  parsed all 83.
- REA leaves directory imports such as `../utils` unresolved (`not-found`). The map resolves them
  by path instead.
- REA also lists RES storage keys, e.g. `RESmodules.userTagger.tags` and `RESoptions.*`, which are
  inputs for the RES backup importer (T119).
- Limits: the analysis is static only. Dynamic calls and runtime behaviour are not covered.

## R19. Search results (live, 2026-10-15)

**Decision**: Treat each search result as a post. The pipeline parses it into the Post model
(src/model/search-post.ts), and the native adapter decorates it at the anchors below. Captured
signed in, using the profile where the user passed Reddit's challenge by hand, on www. and sh., for
both `/search/?q=…&type=posts` and `/r/<sub>/search/`. The structure was the same on all of them.

**Structure** (contracts `search.*`, verified):

- A result is `search-telemetry-tracker[view-events="search/view/post"]`. Nested trackers inside
  it carry the same data but have no `view-events`. The result has no `shreddit-post` and no
  `<article>`. Its computed display is `inline`, but its box is the whole card.
- `data-faceplate-tracking-context` is JSON with `post.id`, `post.title`, `post.nsfw`,
  `post.spoiler`, `profile.name`, `subreddit.name` and `action_info.position`. The author appears
  **only** here: results render no author link.
- `a[data-testid="post-title"]` gives the permalink. It is a full-card overlay (`absolute
  inset-0`). `a[data-testid="post-title-text"]` is the visible title.
- `.post-credit-row` holds the subreddit link, `·` and `faceplate-timeago[ts]`.
- `[data-testid="search-counter-row"]` holds two `faceplate-number[number]` elements: votes, then
  comments.
- Results have no upvote ratio and no vote buttons. Endless scroll appends results of the same shape
  (7 → 35).

**Anchors**:

| Placement | Anchor | Why |
|---|---|---|
| Author and tagline extras (user tag, local date, `[l+c]`) | After the result's own `faceplate-timeago` in its credit row, chained | The row is `position: relative` and comes after the overlay link in the DOM, so REScue's nodes paint above the overlay and stay clickable (live: `elementFromPoint` at the tag returns the tag) |
| Title extras | After `a[data-testid="post-title-text"]` | |
| Hide | The result element itself | It is the card |

When an anchor is missing, nothing is placed. A result has no shadow slot to fall back on.

**What works**: filteReddit (keyword, subreddit, user, NSFW), user tags and ignore, keyboard
navigation and selection, and localDate. **What does not apply**: ratio, voting keys, post body
and media tools. Results carry none of that data and have no controls for it.

## R20. Workarounds for "infeasible" items (live, signed in, 2026-10-15)

**Correction to R10 and to earlier notes**: no Reddit shadow root is closed. Across threads,
listings, `/r/pics`, `/r/news` and search on www. and sh., wrapping `attachShadow` at
document_start found 400–1,400 roots per page, all open. The served HTML has no declarative
shadow DOM.

`shreddit-comment` has NO shadow root at all. Its null `shadowRoot` had been misread as
"closed".

Comment vote controls are in its light-DOM child `shreddit-comment-action-row[slot=actionRow]`:
- **Light-DOM attributes:** `vote-state`, `score`, `comment-id`, `author-name`, `comment-depth`,
  `is-score-hidden`.
- **Open shadow root:** `button[upvote]`/`button[downvote]` with `aria-pressed`, plus
  `faceplate-number` for the score.

Action rows hydrate lazily as comments near the viewport. The isolated world can read open roots
directly. As insurance, `chrome.dom.openOrClosedShadowRoot` works from an MV3 content script and
does read closed roots (proven with a synthetic one). Firefox's equivalent is
`element.openOrClosedShadowRoot`.

| Item | Verdict | Route |
|---|---|---|
| Comment vote (and "upvoted" category, tally from clicks) | Works | `vote-state` on the action row; press `button[upvote]` in its open root and confirm via `aria-pressed`/`vote-state` (UP/DOWN transitions not yet observed live) |
| Comment reply / edit | Works | Reply: light-DOM `faceplate-tracker[slot=comment-reply] > button`. Edit: "Edit comment" item in the row's open `shreddit-overflow-menu` (own comments) |
| Comment score | Works | `shreddit-comment[score]`. A hidden score reads `1`: wait for the row's `is-score-hidden` |
| Post attributes | Works | `locked`, `stickied`, `vote-type`, `is-subscribed`, `award-count`, `created-timestamp`, `item-state`. Not seen in the sample: `nsfw`/`spoiler`. Visited: no signal (use a local visit log) |
| Same-origin JSON (GET, session cookie) | Works | `/subreddits/mine.json`, `/api/info.json?id=…` (batch ≤100: num_comments, locked, saved, hidden, likes; **retired 2026-10-21**: HTTP 403 text/html even signed in, so its readers use `/comments/<id>.json?limit=1&depth=0` and `/comments/<post>/_/<comment>.json` instead), `/comments/<id>.json` (controversiality, gilded), `/api/me.json`, `/prefs/blocked.json`. `oauth.reddit.com` is blocked; `/api/v1/me/*` returns 403 |
| Post save / hide | Partial | Open-root `shreddit-post-overflow-menu` items "Save"/"Hide" ("Remove from saved/hidden" when on). Clicking them is not yet tested |
| User hover card | Works (posts only) | Light-DOM `faceplate-hovercard[data-id=user-hover-card] div[slot=content]` accepts a REScue control. Comment authors have no card |
| Header button | Works | Light-DOM strip near `a#create-post` inside `reddit-header-action-items` |
| Hide inline media | Partial | `display:none` on `div[slot=post-media-container]` stops video autoplay and video downloads, but not image downloads. Real bandwidth saving needs `declarativeNetRequest` plus `*.redd.it` host permissions |

**Constitution impact**: these routes read attributes, use light-DOM anchors, read open roots and
click native controls inside open roots, and make same-origin GETs. Hiding a media slot, and
reading and clicking inside open roots, need a Principle I / V amendment (proposed to the user
2026-10-15).

## R21. Promoted posts and ad slots (live, signed in, 2026-10-16)

Read-only probe (Playwright Chromium, copy of the signed-in profile, no extension, nothing clicked)
of the home feed, r/popular, r/science, r/pics and one r/pics thread, on www. and sh., scrolling
about seven screens with 4.5 s pauses. No challenge or CAPTCHA was shown. Light DOM throughout
except Reddit's own inner shadow roots, which REScue does not touch.

| Slot | Element | Seen | Notes |
|---|---|---|---|
| Promoted post in a feed | `shreddit-ad-post`, direct child of `shreddit-feed` | 4-5 per feed after seven screens, every feed, both hosts | NOT a `shreddit-post`, so the post pipeline never sees it. Attributes `promoted`, `ad-type` (`display` or `video`), `ad-events`, `campaign-id`, `placement`; class `promotedlink`. Rendered (a 620 x 725 box in the sample) |
| Ad above a thread's comments | `shreddit-comments-page-ad`, child of `main#main-content` | 1 per thread, both hosts | Same credit bar and label as the feed ad; 620 x 204 box in the sample |
| Sidebar ad | `shreddit-sidebar-ad` (class `promotedlink`) inside `shreddit-async-loader` in the right sidebar | present on every page | Empty, class `invisible`, 0 x 0 in every sample (no rendered sidebar ad was ever observed), so what a rendered one looks like is unverified |
| Promoted post that is a `shreddit-post` | none | never | No `shreddit-post` carried a `promoted`/ad attribute or a label |

**The label** is `span.promoted-label` reading **"Ad"** (not "Promoted"), inside the advertiser's
`/user/<name>/` link in the ad's `[slot="credit-bar"]` (`div.promoted-name-container`): advertiser
name, a bullet, then "Ad". No leaf anywhere read "Promoted" or "Sponsored". There was also no
`id` containing "ad" or "promoted" on any element.

**Contracts** (`C.promoted`): the three tags are VERIFIED (sidebar: tag only); the label pattern
`^(promoted|sponsored|ad)$` on a credit-bar leaf is a CANDIDATE fallback for a `shreddit-post` that
carries the word. It is exact on one leaf, and a word equal to its link's last path segment (a user
called "Ad") is a name, not a label, so a miss never hides a real post.

**Design consequence**: an ad blocker such as uBlock Origin hides these same elements with
`display:none`, so an element with no box is "already hidden by something else": hidePromoted
counts and marks only elements that had a box. A stylesheet cannot do that alone, so the
stylesheet makes matches `visibility:hidden` (keeps the box, shows no flash) and a scan then sets
`data-rescue-promoted` (`display:none`) on the rendered ones.

## R22. Neutrality filter data source (2026-10-16)

The neutrality filter (a REScue extra, no RES counterpart) needs a domain-to-leaning table that may
be redistributed inside the extension.

| Source | Verdict |
|---|---|
| AllSides | Ratings are CC BY-NC by its terms (non-commercial), there is no machine-readable export, and allsides.com blocks automated access. Rejected. |
| Media Bias/Fact Check | Paid API, no open licence. Rejected. |
| Ad Fontes Media | Commercial. Rejected. |
| DomainDemo (Lazer Lab, 2025) | 129k domains, public on GitHub but with no data licence. Not used; the data format below is source-agnostic so it can replace the file if the lab grants one. |
| Mosleh et al., PNAS 2025 (OSF w5kqt) | Domain quality ratings only, no left/right lean, and no licence. Not used. |
| Buntain et al. 2023 (OSF wtf9y) | No licence. Not used. |
| Wikidata P1387 (political alignment) | About 300 outlets with inconsistent labels (mixed scales and vocabularies). Not used. |
| Robertson, Jiang, Joseph, Friedland, Lazer & Wilson (2018), "Partisan Bias Scores for Web Domains", Harvard Dataverse, doi:10.7910/DVN/QAN5VX | **Chosen, source 1 (long tail).** CC0 1.0. File 3316961 `bias_scores.tab`: 19,022 domains. |
| Eady, Bonneau, Tucker & Nagler, "News Sharing on Social Media: Mapping the Ideology of News Media, Politicians, and the Mass Public", Political Analysis 33(2), 2025 (online Nov 2024), doi:10.1017/pan.2024.19; replication data Harvard Dataverse doi:10.7910/DVN/1QMLOV | **Chosen, source 2 (major outlets, newer).** CC0 1.0 (checked on the Dataverse record). File `News_Domain_Media_Scores.csv` (`domain,zeta,zeta_lower90,zeta_upper90`; also at gregoryeady.com/Data/), 184 unique domains, `zeta` roughly -2 to +2.2 from politicians' news sharing 2017-2020. |

**What is used**: from Robertson only the `domain` and `score` columns. `score` is the authors' own
audience-partisanship measure (-1 shared mostly by Democrats, +1 mostly by Republicans), from a 2017
Twitter panel matched to voter records. The other columns (some derived from third-party raters)
are not shipped. From Eady only `domain` and `zeta`.

**Merging** (`scripts/build-neutrality-data.ts`, all at build time, nothing hard-coded):
1. Normalise domains (lower case, no `www.`, drop keys with `:` or `/` and `.ln.is` hosts; this
   drops three Eady paths such as `yahoo.com/news`); repeated Eady rows are averaged.
2. Fit Robertson on `zeta` by ordinary least squares over the domains in both files. On the
   current files: Robertson = 0.401 x zeta - 0.081, Pearson r = 0.93, n = 175 overlapping domains.
3. Map every Eady domain to `clamp(a * zeta + b, -1, 1)`. This REPLACES the Robertson score for the
   domain (newer data, and better centred: apnews.com -0.33 becomes about -0.07, reuters.com about
   -0.05). Eady-only domains are added.
4. Keep EVERY scored domain (an earlier version cut |score| < 0.3 after merging). The cut served
   hiding only, and hiding does not need it: the levels (min >= 0.7, mid >= 0.5, max >= 0.3) are
   applied at run time, so a domain below 0.3 is never hidden whatever the file holds. The lean chip
   (T143) does need them: a domain Eady moves to the centre (apnews.com about -0.07, reuters.com
   about -0.05; 24 Robertson domains had been dropped this way) is a true "neutral" chip, and without
   it the chip would be missing exactly where it says the most. Round to 3 decimals and write
   `src/data/neutrality-scores.json`.

The file is `{ meta, scores }`: `meta` holds both sources (title, authors, year, doi, licence,
url, period), the fit (`a`, `b`, `r`, `n`), the build date, the counts, and `eady`, the list of
domains whose score came from Eady, so the reason and label can name the right source
("audience lean right 0.73 (Eady et al. 2025)" or "(Robertson et al. 2018)"). 19,012 domains,
181 of them from Eady (465 kB; was 223 kB with the cut). Levels: min >= 0.7, mid >= 0.5, max >= 0.3, applied to each side separately. The chip words use the
same cut-offs (far left <= -0.7, left <= -0.5, lean left <= -0.3, neutral between, then lean right,
right, far right), and its colour is a continuous blend from blue (-1) through grey (0) to red (+1).
A score of exactly 0 is a known domain (24 of them), shown as "neutral".

**Caveats, stated in the module and its credits**
- The score measures who *shares* a domain, not whether the site is accurate or biased. 0 is not
  "neutral".
- About 180 major outlets use the newer Eady et al. data (2017-2020 politicians' sharing, mapped by
  the linear fit above); every other domain is from 2017 and published in 2018, and sites change
  owners and audiences. The mapped Eady scores are an approximation on Robertson's scale, not
  Eady's own numbers.
- Platforms (YouTube, X/Twitter, Imgur, Medium, Substack, GitHub) and Reddit-hosted media are never
  scored: an aggregate score says nothing about an individual creator.
- Only domains present in the data are ever hidden; subdomains match by longest suffix.

**Delivery**: a content script is one IIFE with no code splitting, so `import('...json')` would
have added 465 kB to the script every Reddit page parses. The file is instead copied into the
extension as a data file (`wxt.config.ts`, hook `build:publicAssets`), not web-accessible, and the
background reads it from the extension's own origin (`readBundledJson` in `src/core/net.ts`) when a
content script asks, which happens only when a side is not "off" or the lean chips (`showLean`) are on. No network request is made.

## R23. Old Reddit look (live, signed in, 2026-10-18)

**Decision**: An opt-in look-alike skin (module `oldRedditSkin`, REScue extra; off by default) that
is ONE stylesheet on Reddit's own page, scoped by `html[data-rescue-skin="old"]`, which the module
sets only on feed (home, r/x, r/popular, r/all, custom feed), search and thread routes. Profiles,
settings and everything else never get the attribute. Nothing replaces Reddit's DOM and no shadow
root is entered, so every REScue feature keeps working. Probed read-only on www. with Chromium 156
signed in (r/science, r/popular, home, `/search/?q=science&type=posts`, an 800-comment thread), with
old.reddit.com screenshots of the same subreddit and thread as the reference. sh. and a logged-out
page were NOT probed for this entry (the credit-bar markup is known to differ logged out, R17), so
there the rules are CANDIDATE-quality: a selector that does not match leaves Reddit's own look.

**Styleable (light DOM) and what Reddit exposes**

| Part | Finding |
|---|---|
| Page frame | `.grid-container` (grid) > `#left-sidebar-container` (own shadow root) + `#subgrid-container` > `.masthead`, `.main-container` > `main#main-content` + `#right-sidebar-container`. All light DOM. The left nav is a 272px column from about 1200px wide, a drawer below; the sidebar is shown from about 960px |
| Palette | Reddit's colours are custom properties (`--color-neutral-background[-weak|-strong|-hover|-selected]`, `--color-neutral-content[-strong|-weak]`, `--color-neutral-border[-weak]`, `--shreddit-content-background`) declared on `:root`, `.grid-container`, `.sidebar-grid` and `.stickied` (and re-declared under `.theme-dark`), so a skin must set them on those elements (with !important, as Reddit's dark block out-ranks a plain override). They inherit into every shadow tree |
| Buttons and vote pills | `--size-button-sm-h`, `--color-button-secondary-*`, `--color-upvote-*`, `--color-downvote-*`, `--color-secondary-plain` are read inside the post's shadow root (`.button-secondary`, `.rpl-vote-button-group`). Set on the host they win over the shadow's own `:host` rules: the pills become flat, transparent and 20px. No `::part` is exposed on `shreddit-post` |
| Feed post | `shreddit-feed` (open shadow root) > `article` > `shreddit-post` (open shadow root: `slot`s plus the action row `rpl-action-bar` with vote group, comments pill, share). Two light-DOM shapes. Shape A (`is-slim-card`): one wrapper `div` holding a credit-bar wrapper, a content wrapper (title, flair, `a.post-link`) and a thumbnail wrapper (`[slot=thumbnail]`). Shape B (large card; r/popular, media posts): `[slot=credit-bar]`, `[slot=title]` (inside a shadow `div.flex` with the flair), `[slot=post-media-container]` and two `faceplate-loader`s are direct children |
| Thread post | `main > shreddit-post`: light `#pdp-credit-bar`, `h1[slot=title]`, `[slot=post-media-container]`, `[slot=text-body]`; shadow: title wrapper, action row |
| Comments | `shreddit-comment` has NO shadow root: `details > summary` (avatar column + `[slot=commentMeta]`), `div.grid` (thread line `.ssr-thread-line`, `[slot=comment]` body, `[slot=actionRow]`, `#comment-children`). Only the action row (`shreddit-comment-action-row`) has an open shadow root |
| Search result | `[data-testid=search-post-unit]` flex row: text column + `search-telemetry-tracker` thumbnail (a fixed 120px box); no shadow root |

**Not styleable, and how it was handled**
- **The vote control**: it lives in the post's shadow root, so a column of arrows beside the rank
  cannot be reached. Rebuilding it in a vertical column was tried and rejected: `writing-mode`
  inherits into the shadow tree, but it also flips the host's own grid and gives the box the
  viewport height (orthogonal flow), and the comments and share pills would stack in the same column.
  Handled by restyling through Reddit's exposed custom properties: arrows, score, comments and share
  stay in Reddit's action row under the tagline as small flat grey buttons (arrows turn old
  Reddit's orange and blue when voted), and the rank number (a CSS counter) takes the left column.
  A "show vote column" option is therefore not offered.
- **The action row and (shape B) the title wrapper are in the shadow root** and cannot be named. They
  are flat-tree children of the post, so the post becomes a CSS grid and they are auto-placed: every
  other cell the auto-placement could take is filled on purpose (`::before` rank, `::after`
  thumbnail column, the `faceplate-loader`s), so the first free cells are the right ones. Reddit's own
  wrapper grid (shape A) is flattened with `display: contents` and its parts are given cells.
- **Cards**: Reddit's rounded, shaded card and its hover tint are removed on the post host (a
  light-DOM element). Large media (shape B) is shrunk to the thumbnail size with `zoom` on its
  container (pointer events off) instead of being hidden, so posts keep a picture; "thumbnails: none"
  hides it. Promoted posts (`shreddit-ad-post`) are left in Reddit's own look: hidePromoted exists for them.
- Rank numbers are `counter()`s, so ads do not take a number; the share/crosspost pills stay, the
  words "comments / share / save / hide / report" of old Reddit are not synthesised (the first two
  are Reddit's own icon pills; save and hide are in Reddit's "…" menu and REScue's hide word).

**Contracts**: `C.skin.*` in `src/contracts/reddit.ts` (VERIFIED LIVE 2026-10-18 on www., signed in).
The grid-cell trick depends on the two Reddit shapes above; a post that matches neither keeps
Reddit's own layout inside the grid.

## R24. Old Reddit look, second pass: REScue-drawn rows (live, signed in, 2026-10-18)

**Decision**: R23 could not draw old Reddit's vote column, tagline or link row because the vote pill
and action row live in the post's shadow root. R24 draws them in REScue's own light-DOM elements
(appended to `shreddit-post` / `shreddit-comment`) and parks Reddit's own rows out of sight while
they are mounted (`data-rescue-ov` on the host; no mark, no change: Reddit's own look and vote
buttons stay). The user approved hiding Reddit's light-DOM pieces (credit bar, title, flair, thumbnail
placeholder, comment action row) for this opt-in skin; nothing is written into a shadow root.

**Parking the sealed shadow items (verified live, www., Chromium 156)**: the feed post's shadow root
has `slot[name=full-post-link]`, the default slot, and a block `div` holding the action row (shape A);
shape B and a thread post put `div.flex` (title wrapper) and `div.shreddit-post-container` (action
row) as flat-tree children. They cannot be named, but an explicitly placed pseudo-element
(`::after { grid-area: 1 / 1 / 2 / -1 }`) fills every cell of the first row, so auto-placement puts
them into implicit rows that are 0 high (`grid-auto-rows: 0`); the post is `overflow: clip` with no
bottom padding, so they overflow below the box and are clipped. They stay in the page, and the
bridge keeps pressing their buttons. Reddit's light children are parked with a default
`grid-area: 2 / 1`; the credit bar is made 1px with `clip-path` (not `overflow`, so lazy hydration
still sees it) because its overflow menu is how Save, Hide and Report are pressed.

**Controls**: votes -> `ctx.actions.vote` (state from `aria-pressed`, number from `score` moved by
the change in the reader's own vote); save / hide -> existing menu actions; report -> new
`ctx.actions.report` (menu row "Report", opens Reddit's own dialog; verified live); share -> new
`ctx.actions.share` (`button[part=share-button]` in the share button's own shadow root, found by the
bridge's deep search; its menu is hoisted and is not clipped; verified live); reply ->
`startReply`. Comments' action row is parked with a 1px `clip-path` box (it holds Reddit's reply
box once Reply is pressed; the row is shown while `comment-composer-host` is inside it). REScue's
arrows are labelled "vote up/down" because the bridge also matches `[aria-label*=upvote]` in light
DOM first. Decorations (tag, ignore, filter ...) are placed after REScue's own author link and
end-of-tagline mark (`data-rescue-anchor`), since Reddit's credit bar is hidden.

**Sort tabs**: read from Reddit's own `shreddit-sort-dropdown[sort-event=feed-sort-change]`
(`data[value]` with the real link; home lists BEST HOT NEW TOP RISING), the rest computed for home,
subreddit, r/all and r/popular. The comment sort dropdown has no links and stays Reddit's own.

**Not offered**: embed and crosspost (cannot be made), a fake logo or account strip (the header bar
is Reddit's own, moved down by the shortcut strip), old.reddit.com side-by-side captures (the site
redirects to www. for this account).

## Feature-matrix changes from this research

| Module | Was | Now | Source |
|---|---|---|---|
| userInfo | Deferred | Adapted | R4 |
| redditUserInfo | Deferred | Adapted | R4 (merged into userInfo) |
| showKarma | Deferred | Adapted | R6 |
| subredditInfo | Deferred | Adapted | R5 |
| userHighlight | Ported | Ported (mod/admin pending R7) | R7 |
| orangered | Deferred | Deferred (capture task) | R6 |
| sourceSnudown | Deferred | Deferred | R8 |
