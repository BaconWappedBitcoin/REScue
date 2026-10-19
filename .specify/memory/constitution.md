<!--
Sync Impact Report (2.1.0)
- Version change: 2.0.0 → 2.1.0 (MINOR: Principles I, III, IV and V expanded; Platform amended)
- Reason: the user asked for exhaustive RES parity and for workarounds to "infeasible" items
  (2026-10-15). A live probe (research R20) found that no Reddit shadow root is closed, that
  comment controls sit in open roots, and that same-origin `.json` reads work with the session.
  The user approved this amendment the same day, including optional blocking of media downloads.
- Modified principles:
  I. Adds reading of, and clicking native controls inside, OPEN shadow roots; never writing into
     them. Adds hiding one named Reddit slot only as an opt-in, reversible, per-feature setting.
  III. Hidden slots must always show a visible way to bring them back.
  IV. Media-download blocking (declarativeNetRequest) is listed as opt-in.
  V. Adds read-only same-origin GETs to `.json` endpoints listed in the contracts module.
- Platform: `declarativeNetRequest` and `*.redd.it` host access, used only by opt-in media blocking.
- Follow-up: feature-matrix.md, ui-parity.md and research R20 updated; tasks.md gains the
  workaround tasks.

Previous report (2.0.0)
- Version change: 1.0.0 → 2.0.0 (MAJOR: Principle I redefined; Principle III and Platform amended)
- Reason: native-only pivot (2026-10-15). REScue enhances Reddit's own layout; the classic
  (old-reddit) layout is removed for 1.0 and archived at git tag `archive/classic-layout`.
- Modified principles:
  I. "Rebuild From the Page, Behind One Contract" → "Read From the Page, Decorate Reddit's Own Layout"
  II. Honest Feature Parity — adds the "Built-in" status for RES features modern Reddit provides
  III. Fail Visible, Fall Back Native — page-hiding gate removed (REScue no longer hides pages)
- Platform: the gate-deadline performance clause is removed.
- Follow-up: spec.md (US1, FR-005, FR-007, FR-011–FR-013, FR-016, FR-018–FR-020, SC-003), plan.md,
  tasks.md and feature-matrix.md amended the same day.
-->

# REScue Constitution

REScue is a browser extension that brings the Reddit Enhancement Suite (RES) experience to modern
Reddit (`www.reddit.com`, the "shreddit" front end) and `sh.reddit.com`, by enhancing Reddit's own
layout.

## Core Principles

### I. Read From the Page, Decorate Reddit's Own Layout

- REScue MUST read Reddit's data from what the page already delivers (e.g. attributes on
  `shreddit-post` / `shreddit-comment` elements) rather than scraping rendered text or
  reverse-engineering utility CSS classes.
- Every selector, custom-element tag, attribute name, and endpoint path that Reddit owns MUST
  live in a single contracts module. No feature module may hard-code a Reddit selector.
- REScue MUST NOT hide or replace Reddit's page. Features add REScue-owned elements only at
  anchors verified live (light DOM, e.g. next to a post's or comment's author link, or in a named
  slot of Reddit's post/comment components).
- REScue MAY read attributes and OPEN shadow roots of Reddit's components, and MAY dispatch a click
  on a native control inside an open root, to read state or delegate an action. Every selector
  stays in the contracts module, results are confirmed from page state, and the feature disables
  itself when its contract drifts. REScue MUST NOT write into, restyle, or inject elements inside
  any Reddit shadow root.
- Only behind a per-feature, default-off user setting, REScue MAY hide one named Reddit slot (e.g.
  a post's media container). It MUST show a visible REScue control that brings it back.
- Where modern Reddit already provides an RES feature with the same options, REScue does not
  duplicate it. "Built-in" applies only when Reddit offers the same outcome, including the
  option's choices.

Rationale: Reddit redeploys without notice. Keeping the "blast radius" of a Reddit change to one
file is what makes the project maintainable (lesson inherited from Sheddit).

### II. Honest Feature Parity

- Every RES module MUST be triaged in the feature matrix as **Ported**, **Adapted**,
  **Built-in** (modern Reddit already provides it), **Deferred**, or **Infeasible**, with a one-line
  reason.
- A control MUST NOT claim to have done something it cannot verify (e.g. a vote arrow that lights
  up without a vote being cast). If an action cannot be confirmed, the UI says so.
- Infeasible RES features are documented, not faked.

Rationale: RES was trusted because it did what it said. A half-working clone is worse than an
honest subset.

### III. Fail Visible, Fall Back Native

- Each feature module MUST detect when its contracts no longer match the page and disable itself,
  leaving Reddit's native UI usable.
- REScue MUST NEVER leave the user with a blank or unusable page. It does not hide Reddit's page;
  what it adds can always be turned off from the settings console, and any Reddit slot it hides
  by the user's choice has a visible control to bring it back.
- A failure in one module MUST NOT break other modules (isolated init, caught errors).

### IV. Local-First Privacy

- No telemetry, analytics, tracking, or third-party servers. Settings, tags, filters, and saved
  data live in browser extension storage on the user's device.
- Network requests are limited to Reddit origins already used by the page and to media hosts the
  user has enabled for inline expansion; each external host is listed in the privacy document.
- Blocking Reddit's media downloads (declarativeNetRequest) is opt-in, off by default, and listed
  in the privacy document. It only blocks; it never sends anything.
- Backup/restore is user-initiated export/import of a local file (or a user-chosen sync storage).

### V. Delegate, Never Impersonate

- REScue MUST NOT store, request, or transmit Reddit passwords or OAuth tokens. (RES's password
  storing Account Switcher is explicitly out of scope.)
- Authenticated actions (vote, save, reply, hide, subscribe) MUST either drive Reddit's own
  controls or use same-origin requests carrying the session the user already has, and MUST be
  confirmed from the page state before reporting success.
- Read-only same-origin GET requests to Reddit `.json` endpoints listed in the contracts module are
  permitted, carrying the user's existing session. REScue MUST NOT send POST, PUT, PATCH or DELETE
  requests to Reddit, and MUST NOT call `oauth.reddit.com`. Writes always go through Reddit's own
  controls.
- Logged-out reading MUST keep working; logged-in features degrade cleanly when signed out.

### VI. Test Against Fixtures and Live Contracts

- Feature logic is written test-first against synthetic fixtures built from captured live
  structure (unit/jsdom + real-browser layout tests).
- A live contract check MUST exist that re-verifies the contracts module against real
  `www.reddit.com` and `sh.reddit.com` pages and reports which contracts drifted.
- Every fixed regression gets a test that reproduces it.

## Platform & Licensing Constraints

- Target: Manifest V3 extension for Chromium browsers (primary) and Firefox (supported).
- Hosts: `www.reddit.com`, `reddit.com`, `sh.reddit.com`. `old.reddit.com` is out of scope except
  for an optional redirect to the equivalent modern page.
- License: GPL-3.0-or-later. REScue derives ideas and possibly code from RES and Sheddit (both
  GPL-3.0); upstream copyright and attribution MUST be preserved in any reused file.
- No remotely hosted code (store policy): all scripts ship in the package.
- Permissions: storage and the Reddit hosts. `declarativeNetRequest` and `*.redd.it` host access
  are used only by opt-in media blocking. Request them as optional permissions where the browser
  allows, so they are granted only when the user enables the setting.
- Performance: REScue MUST NOT add more than 100 ms of main-thread work per batch of new
  content.

## Development Workflow & Quality Gates

- Spec Kit flow per feature: specify → clarify → plan → tasks → implement, on a feature branch.
- Every plan MUST pass the Constitution Check against Principles I–VI before task generation.
- A change touching the contracts module MUST include updated fixtures and a live-contract run.
- Build, lint, and all test suites MUST pass before merge; feature-matrix entries MUST be updated
  whenever a module's status changes.

## Governance

This constitution supersedes other project practices. Amendments are made by pull request that
updates this file, states the version bump with rationale, and lists affected specs/plans.
Versioning: MAJOR for removing or redefining a principle, MINOR for adding or materially expanding
one, PATCH for clarifications. Reviews MUST check compliance; any deviation is recorded in the
plan's Complexity Tracking table with justification.

**Version**: 2.1.0 | **Ratified**: 2026-10-15 | **Last Amended**: 2026-10-15
