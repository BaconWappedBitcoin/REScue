# Feature Specification: REScue Foundation — RES for Modern Reddit

**Feature Branch**: `001-rescue-foundation`

**Created**: 2026-10-15

**Status**: Draft — **amended 2026-10-15 (native-only pivot)**

**Input**: User description: "Recreate the Reddit Enhancement Suite (RES) for new Reddit and
sh.reddit.com. Sheddit may be a good place to start for old-reddit formatting, although it's not
1:1. Enable whatever RES features can still work on new Reddit and sh.reddit.com. Project name:
REScue."

**Amendment (2026-10-15)**: "Remove classic for now; we can focus on it later if we need to."
REScue now enhances Reddit's own layout only. The classic (old-reddit) layout built for the first
version of User Story 1 is removed for 1.0 and archived at git tag `archive/classic-layout`. RES
features that modern Reddit already provides are marked **Built-in** in the feature matrix rather
than rebuilt. Withdrawn requirements keep their numbers so references stay valid.

**Reference material**: RES (`honestbleeps/Reddit-Enhancement-Suite`, 81 user-facing feature
modules) and Sheddit (`kookaburrabarrel/sheddit`). Every RES module is triaged in
[feature-matrix.md](./feature-matrix.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - RES settings console on Reddit's own layout (Priority: P1)

A former RES user installs REScue and opens `www.reddit.com` or `sh.reddit.com`. Reddit looks and
works as usual. A REScue gear opens a settings console that lists every module, with on/off
toggles, per-module options, search, presets and backup/restore.

**Why this priority**: The module system, settings and backup are what every other feature sits
on.

**Independent Test**: Install the extension, visit a front page, a subreddit, a profile and a
thread on both hosts; confirm Reddit is unchanged apart from REScue's additions, the console opens,
a module toggle persists across reloads, and export → reset → import restores settings.

**Acceptance Scenarios**:

1. **Given** REScue is installed, **When** the user opens any supported Reddit page, **Then** Reddit's
   own layout appears unmodified except for REScue's additions, with no delay or hiding.
2. **Given** the settings console is open, **When** the user disables a module and reloads,
   **Then** that module stays disabled and its effects are gone.
3. **Given** the user has customised settings, **When** they export a backup, reset to defaults,
   and import the backup, **Then** all settings, tags, and filters are restored.

---

### User Story 2 - Filter out unwanted content (Priority: P1)

The user hides posts by keyword, subreddit, domain, user, flair, or NSFW status, matching RES's
filteReddit. Filters can be global or scoped to particular subreddits, and support regular
expressions.

**Why this priority**: filteReddit was among the most-used RES features and needs only data the
page already provides.

**Independent Test**: Add a keyword filter and a subreddit filter, open `/r/all`, and confirm
matching posts are hidden while a counter shows how many were filtered and allows revealing them.

**Acceptance Scenarios**:

1. **Given** a keyword filter "foo", **When** a listing contains a post titled "Foo bar", **Then**
   that post is hidden and the filtered count increments.
2. **Given** a subreddit filter scoped to `/r/all` only, **When** the user visits that subreddit
   directly, **Then** its posts are shown.
3. **Given** filtered posts on a page, **When** the user chooses "show filtered", **Then** they
   appear marked as filtered, with the rule that matched.
4. **Given** Reddit loads more posts as the user scrolls, **When** they arrive, **Then** filters apply
   to them before they are displayed.

---

### User Story 3 - Keyboard navigation (Priority: P2)

The user moves through Reddit's posts and comments with RES keyboard shortcuts (j/k, enter, shift+j/k
between comment threads, `?` for help); the selected item is outlined and kept in view.

**Why this priority**: Keyboard navigation is a signature RES feature Reddit does not provide.

**Independent Test**: On a listing and a thread, press j/k and confirm the selection moves over
Reddit's own posts/comments and stays in view; press `?` to see the shortcut list.

**Acceptance Scenarios**:

1. **Given** a listing, **When** the user presses j/k, **Then** the selection moves down/up one post
   and is visibly outlined.
2. **Given** the user is typing in a text box (including Reddit's comment editor), **When** they
   press a shortcut key, **Then** the key types normally and no shortcut fires.
3. **Given** the selection reaches the last loaded post, **When** the user presses j, **Then** the page
   scrolls so Reddit loads more, and the selection continues onto the new posts.
4. **Given** shortcuts were rebound in settings, **When** the user presses the new key, **Then**
   the rebound action fires.

---

### User Story 4 - Inline media expansion — **Withdrawn (Built-in)**

Modern Reddit shows images, galleries and videos inline in its own feed and threads. The RES-style
expando implementation built for the classic layout is archived; expandos for external hosts in
comments are Deferred (feature matrix: showImages).

---

### User Story 5 - Tag and highlight users (Priority: P2)

The user attaches a tag (text, colour, optional link), a vote-balance tally, or an ignore flag to
any username, as with RES User Tagger. Moderator, friend and tagged authors are highlighted;
Reddit already marks the OP.

**Why this priority**: User tagging is purely local, works logged out, and was a heavily used RES
feature.

**Independent Test**: Tag a user, reload a thread they comment in, and confirm the tag appears next
to every instance of their name; mark a user ignored and confirm their content is collapsed.

**Acceptance Scenarios**:

1. **Given** a tagged user, **When** their name appears on a post or comment, **Then** the tag shows
   beside it in the chosen colour.
2. **Given** an ignored user, **When** their comment appears, **Then** it is collapsed or hidden
   according to the ignore setting.
3. **Given** a comment by a moderator acting as moderator, **When** the thread renders, **Then** the
   author's name is highlighted as a moderator.

---

### User Story 6 - Comment-thread power tools (Priority: P3)

In threads the user can hide all child comments, jump between comments by OP/mod/tagged
user/popularity (Comment Navigator), see parent comments on hover, see which comments are new since
their last visit, and save comments locally. Collapsing and context links are Built-in.

**Why this priority**: These enrich reading on top of Reddit's own threads.

**Independent Test**: Visit a thread, leave, return later, and confirm new comments are marked and
counted; use the navigator to step through OP comments; save a comment and find it on the saved
list.

**Acceptance Scenarios**:

1. **Given** a previously visited thread, **When** the user returns, **Then** comments posted since
   the last visit are marked and the listing shows a "(N new)" count.
2. **Given** the navigator set to "OP", **When** the user presses next, **Then** focus jumps to the
   next comment by the submitter.
3. **Given** a nested comment, **When** the user hovers its "parent" control, **Then** the parent
   comment is shown in a popup.
4. **Given** a top-level comment with replies, **When** the user chooses "hide child comments",
   **Then** all replies collapse, and the control toggles back.

---

### User Story 7 - Keyboard actions on Reddit's controls (Priority: P3)

Signed in, the user votes and saves from the keyboard on the selected item. REScue presses Reddit's
own controls and reports success only when Reddit's state confirms it. Reddit's own voting, replying
and composer (with formatting and preview) are used directly and are Built-in.

**Independent Test**: Signed in, press the vote and save keys on a post and a comment; reload and
confirm each persisted. Signed out, confirm the key reports that sign-in is required.

**Acceptance Scenarios**:

1. **Given** a signed-in user and a selected post, **When** they press the upvote key, **Then** Reddit's
   upvote control is pressed and REScue reports success only after Reddit shows the vote.
2. **Given** a signed-out user, **When** they press the upvote key, **Then** REScue says sign-in is
   required and nothing changes.

---

### User Story 8 - Appearance and tweaks (Priority: P4)

The user adds custom CSS, sees local dates beside Reddit's relative times, hides their own username
(screenshot mode), and uses a subreddit shortcut bar. Dark mode is Built-in.

**Independent Test**: Add custom CSS and confirm it applies; enable username hiding and confirm the
account name is masked; configure the shortcut bar and confirm it shows on every page.

**Acceptance Scenarios**:

1. **Given** username hiding is on, **When** any page loads, **Then** the signed-in username is masked
   wherever it appears.
2. **Given** a subreddit shortcut bar is configured, **When** any page loads, **Then** the bar shows
   the user's chosen subreddits in their chosen order.

---

### Edge Cases

- Reddit renames an element, attribute or slot REScue depends on: the affected module disables
  itself, Reddit stays fully usable, and a notice identifies the broken module.
- Pages REScue does not enhance (settings, chat, mod tools, wiki, inbox) are left untouched.
- The same post appears in a later batch: it is decorated once.
- A user types in Reddit's or REScue's text fields: no navigation shortcut fires.
- Login walls, age gates, and quarantine interstitials: handled visibly, never silently bypassed in
  a way that misrepresents consent (see FR-008).
- `old.reddit.com` links: optionally redirected to the equivalent modern page with a short notice.
- Extremely long threads (5,000+ comments): decorating stays responsive.
- Storage quota pressure from large tag/read-comment histories: the oldest read-tracking entries
  are pruned first; tags and filters are never pruned.
- Sign-out mid-session: signed-in-only features switch to their signed-out state without a reload.

## Requirements *(mandatory)*

### Functional Requirements

**Platform & module system**

- **FR-001**: REScue MUST run on `www.reddit.com`, `reddit.com`, and `sh.reddit.com` page types:
  front page, `/r/all`, `/r/popular`, subreddit listings, custom feeds, user profiles, search
  results, and comment threads.
- **FR-002**: REScue MUST organise functionality into independently toggleable modules, each with a
  name, category, description and options.
- **FR-003**: Users MUST be able to search, enable/disable, and configure every module from a
  settings console reachable from every supported page.
- **FR-004**: REScue MUST persist all settings and user data locally and support export to and
  import from a file, plus optional browser-account sync of settings.
- **FR-005**: REScue MUST enhance Reddit's own layout only. It MUST NOT hide or replace Reddit's
  page; it adds its own elements only at anchors verified live (beside author links, in Reddit's
  post/comment slots, or as floating REScue UI). The classic (old-reddit) layout is out of scope for
  1.0 (archived, git tag `archive/classic-layout`).
- **FR-006**: When a module's page dependencies no longer match, that module MUST disable itself for
  the page and surface a non-blocking notice; the rest of REScue and Reddit MUST keep working.
- **FR-007**: *(Withdrawn 2026-10-15: REScue no longer hides Reddit's page, so there is no gate.)*
- **FR-008**: REScue MUST handle the NSFW age gate by showing its own notice with a Continue
  control; Continue presses Reddit's own confirmation, so it is the user's action. Automatic
  confirmation is an option, off by default. Hiding Reddit's undismissable login-wall overlay is an
  option, off by default. REScue MUST NOT click Reddit's log-in or sign-up controls.

**Content features** (see feature-matrix.md for the full RES mapping)

- **FR-010**: Users MUST be able to filter posts by keyword, subreddit, domain, user, flair, and
  NSFW status, with optional per-subreddit scoping and regular expressions, and to reveal filtered
  posts on demand.
- **FR-011**: REScue MUST provide configurable keyboard navigation over Reddit's posts and comments,
  including a help overlay, and MUST NOT intercept keys typed into text fields.
- **FR-012**: *(Withdrawn 2026-10-15: Built-in — Reddit loads more posts and comments itself.)*
- **FR-013**: *(Withdrawn 2026-10-15: Built-in — Reddit expands its own media inline.)*
- **FR-014**: Users MUST be able to tag, colour, vote-tally, and ignore usernames; tags MUST appear
  beside every post and comment author link REScue can reach.
- **FR-015**: REScue MUST highlight moderator, admin, friend and tagged authors where the page
  identifies them (Reddit already marks the OP).
- **FR-016**: REScue MUST provide comment-thread tools: hide child comments, comment navigator,
  show-parent-on-hover, new-comment marking with counts, and local comment saving.
- **FR-017**: REScue MUST track read posts/comments locally to support new-comment counts and
  optional auto-hiding of read posts.
- **FR-018**: For signed-in users, REScue MUST support keyboard vote and save on the selected item by
  pressing Reddit's own controls, and MUST report success only after Reddit's state confirms it.
- **FR-019**: *(Withdrawn 2026-10-15: Built-in — Reddit's composer has formatting and preview.)*
- **FR-020**: REScue MUST provide user custom CSS, local-time dates, username hiding, and a
  subreddit shortcut bar. (Dark mode and a pinned header are Built-in.)

**Privacy & safety**

- **FR-030**: REScue MUST NOT collect telemetry or send user data to any non-Reddit server.
- **FR-031**: REScue MUST NOT ask for, store, or transmit Reddit passwords or tokens.
- **FR-032**: REScue MUST ship a feature matrix stating, for every RES module, whether it is Ported,
  Adapted, Built-in, Deferred, or Infeasible, and why.

### Key Entities *(include if feature involves data)*

- **Module**: a unit of functionality; id, category, description, enabled flag, options, health
  status on the current page.
- **Settings Profile**: all module options; versioned for migration; exportable.
- **Post**: id, title, permalink, link URL/domain, author, subreddit, score, upvote ratio, comment
  count, created time, flair, NSFW/spoiler flags.
- **Comment**: id, parent id, depth, author, score, created time, body, permalink, distinguished
  status (mod/admin), OP flag.
- **User Tag**: username, text, colour, link, vote tally, ignored flag.
- **Filter Rule**: type (keyword/subreddit/domain/user/flair/NSFW), pattern, regex flag, scope
  (everywhere / listed subreddits / except listed), enabled.
- **Read Record**: thread id, last-visit time, comment count at last visit; prunable.
- **Saved Comment**: comment id, permalink, author, body snapshot, saved time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can install REScue and have filters and the settings console working
  on Reddit within 2 minutes, without configuration.
- **SC-002**: Every one of RES's 81 modules is triaged in the feature matrix, and at 1.0 every
  module marked Ported or Adapted is working.
- **SC-003**: *(Withdrawn 2026-10-15: REScue no longer hides Reddit's page.)*
- **SC-004**: New content Reddit loads is filtered and decorated within 200 ms of arriving on a
  mid-range laptop (4× CPU throttle in tests).
- **SC-005**: When a Reddit change breaks a dependency, the affected modules are identified by the
  live contract check within one run, and Reddit stays fully usable in 100% of cases.
- **SC-006**: With default settings, REScue itself initiates zero network requests to non-Reddit
  hosts. Requests made by Reddit's own page are out of scope. This is verified by comparing the set
  of hosts contacted with REScue enabled against the same pages with REScue disabled.
- **SC-007**: A settings export imported on a fresh install reproduces 100% of settings, tags, and
  filters.

## Assumptions

- Primary users are former RES users on desktop browsers; mobile browsers are out of scope for 1.0.
- Chromium browsers are the primary target and Firefox is supported; Safari is out of scope.
- Both signed-out and signed-in reading are supported. Signed-in actions use Reddit's own controls;
  REScue never handles credentials.
- `sh.reddit.com` and `www.reddit.com` serve the same modern front end, so one set of page
  contracts covers both, with per-host overrides only where measured differences exist.
- REScue's additions are placed beside author links and in Reddit's `credit-bar`, `title` and
  `commentMeta` component slots, verified live on 2026-10-15 (research R17). Reddit's action rows
  (vote/reply/share) sit inside closed components and are not decorated.
- REScue is licensed GPL-3.0-or-later, compatible with reusing RES and Sheddit code with
  attribution.
- RES's password-storing Account Switcher, subreddit CSS toggling, and old-reddit-only moderator
  tools are out of scope, as recorded in the feature matrix.
