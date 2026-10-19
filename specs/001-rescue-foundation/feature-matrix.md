# RES → REScue Feature Matrix

Every user-facing module in RES (`lib/modules/*.js`) triaged for modern Reddit
(`www.reddit.com` / `sh.reddit.com`). Required by Constitution Principle II and FR-032.

**Amended 2026-10-15 (native-only pivot)**: REScue enhances Reddit's own layout; the classic
(old-reddit) layout is removed for 1.0 and archived at git tag `archive/classic-layout`. Every row is
re-triaged for Reddit's own layout. Verified live the same day: REScue can add its own elements
next to a post's or comment's author link and in the `credit-bar`, `title` and `commentMeta` slots
of Reddit's post and comment components (research R17). Search results are not `shreddit-post`;
since T133 they are parsed into the same post model, so post features that need only a result's
own data (filters, user tags, keyboard navigation, local dates) work there too (research R19).

**Status key**

- **Ported**: same behaviour, reimplemented for Reddit's own layout.
- **Adapted**: the user goal is kept, but the behaviour changes to fit modern Reddit.
- **Built-in**: modern Reddit already provides this; REScue does not duplicate it.
- **Deferred**: probably feasible, but needs research or is out of 1.0 scope.
- **Infeasible**: conflicts with the constitution, or the underlying Reddit feature no longer exists.

**Built column**: ✓ working now · ◐ partly (see note) · — not yet built.

## Core & settings

| RES module | Status | Built | Story | Notes |
|---|---|---|---|---|
| menu (gear dropdown) | Adapted | ✓ | US1 | Floating REScue gear on Reddit's page |
| settingsNavigation | Ported | ✓ | US1 | Settings console with search and deep links |
| backupAndRestore | Ported | ✓ | US1 | File export/import plus optional browser sync; no third-party cloud. "Import from RES" reads an RES backup file for user tags and filteReddit filters only, and lists what it skipped |
| presets | Ported | ✓ | US1 | "Lite", "Classic RES", "Clean slate", "No popups" |
| customToggles | Ported | ✓ | US1 | Switches that filter rules can be tied to |
| commandLine | Ported | ✓ | US3 | Navigation, search, settings, toggles, commands by name |
| troubleshooter | Adapted | ✓ | US1 | Feature health, diagnostic report, reset, clear caches, clear vote-only tags, turn REScue off in this tab, test notices |
| version / announcements / about / RESTips / onboarding | Adapted | ✓ | US1 | One About panel; tips optional, a "Tips" menu row, and an update notice (feature release / bug-fix release) with new-feature tips |
| contribute | Adapted | ✓ | — | In About |
| submitIssue | Adapted | ✓ | — | Diagnostic report for bug reports |
| requestPermissions | Deferred | — | — | Only needed if external media hosts return (see showImages); REScue requests no host permissions |
| easterEgg | Infeasible | — | — | Feasible; T147 added it as module `easterEgg` (Konami code, a local bacon shower, off by default) |

## Listings & browsing

| RES module | Status | Built | Story | Notes |
|---|---|---|---|---|
| filteReddit | Ported | ✓ | US2 | Keyword/sub/domain/user/flair/NSFW; hides Reddit's post wrappers before paint; reveal with reason. Inline controls (T132): a ⊘ button after each post's time filters its subreddit (RES default: hidden everywhere except on that subreddit), author or domain in one click, and a "+ filter r/sub" toggle on subreddit pages does the same, both with an instant effect and Undo |
| keyboardNav | Adapted | ✓ | US3 | j/k, enter/c, shift+j/k between comment threads, p, go-mode and ? help over Reddit's posts and comments; a/z vote on the selected post or comment via Reddit's own buttons (comment buttons are in the action row's open shadow root, R20); s / h / Ctrl+S save and hide the selected post or comment through its own overflow menu (account-side; onHideMoveDown steps down after a hide); n loads the selected comment's own "more replies"; r/e reply and edit on comments; Ctrl+Y / Ctrl+Shift+Y permalink, Alt+O link only, Shift+S save-RES (US7) |
| selectedEntry | Adapted | ✓ | US3 | Part of keyboardNav: a REScue-drawn outline over the selected post/comment (Reddit's elements are not restyled); click to select |
| wheelBrowse | Adapted | ✓ | US3 | Off by default; the wheel moves the selection only over its own small control |
| singleClick | Adapted | ✓ | US3 | "[l+c]" in the post's credit-bar slot opens link and comments in new tabs |
| neverEndingReddit | Adapted | ◐ | US3 | Reddit auto-loads; REScue `feedPause` adds RES's pause, click-to-load ("load more" with retries) and "pause after N pages", plus a pause/resume menu item. T147 adds remembering a chosen pause across pages, "Page N" markers on the first post of each loaded page, an end-of-feed notice and a state-wording menu label (reversePauseIcon) |
| showImages (expandos) | Adapted | ✓ | US4 | Reddit always shows media inline; REScue `inlineMedia` hides the pictures/GIFs/videos inside comments behind "show image/GIF/video" words (T153; default off) and, with a separate option, the post's own media behind "show image/video/gallery", with a menu toggle, `x`/Shift+X, scope/type/per-subreddit options, remembered expansions and opt-in download blocking (optional declarativeNetRequest). `mediaViewer` (T145) adds media width/height limits, post-text and comment scroll caps, gallery filmstrip, a plain video player, picture-link expandos for Reddit-hosted pictures, and size/move keys (= - + _ Shift+Right Ctrl+arrows); no own DASH player, no zoom/drag/rotate viewer |
| autoHide | Adapted | ✓ | US6 | Needs read tracking; "Also hide on Reddit" (off by default) additionally hides through the account via the post's own Hide row |
| xPostLinks | Adapted | ✓ | — | Reddit's crosspost card covers real crossposts; REScue `xPostLinks` links "x-post from r/foo" mentions in titles using RES's patterns |
| temporaryDropdownLinks | Built-in | — | — | Reddit's sort and time-range menus |
| pageNavigator | Adapted | ✓ | US8 | "↑ Top" button in REScue's tool strip. RES's jump-to-new-comment-box and pinned post title are not built (Reddit has a composer and a sticky header of its own): Infeasible |
| searchHelper | Adapted | ◐ | US8 | Default sort/time for the search results address, and "search inside this subreddit" from the header form when it is reachable. Depends on candidates `chrome.searchForm` and `search.params` (unverified). RES's option panel, legacy search, search tabs, flair search and "filter user results by subreddit": Infeasible (Reddit's search page is its own component) |
| quarantineHide | Adapted | ✓ | US1 | Explains the quarantine prompt; never confirms for you |
| noParticipation | Deferred | — | US7 | The np.reddit.com host is lost on redirect; a background webRequest/DNR observer of the np hop could restore the signal (needs an np host permission) |
| profileRedirect | Ported | ✓ | US1 | Default profile tab |
| profileNavigator | Built-in | — | — | Reddit's profile tabs; T147 adds module `profileNavigator` (opt-in): your own profile pages as rows in the REScue menu, with a configurable list |
| logoLink | Ported | ◐ | US8 | Rewrites the header logo's `href` (front page, r/all, r/popular, current subreddit, my profile, custom path). Depends on candidate `chrome.logoLink`. RES's dashboard and inbox destinations: Infeasible |
| multiredditNavbar | Built-in | — | — | Custom feeds in Reddit's left navigation |
| subredditManager (shortcut bar) | Adapted | ◐ | US8 | Fixed slim bar bottom-left; ordered list plus links; "+ r/name" button on a subreddit page. Importing subscriptions from the left nav: **Deferred** (the left nav's community list was never captured and verified). RES's dropdown, search, subscribe buttons and subscription sorting: Built-in or Infeasible |
| subredditTagger | Adapted | ✓ | US2 | Tag shown in the post's credit-bar slot |
| subredditInfo (hover card) | Built-in | — | — | Reddit's community hover cards |
| tableTools | Ported | ✓ | US6 | Sortable tables in post/comment bodies |
| spoilerTags | Built-in | — | — | Reddit renders spoilers |
| localDate | Adapted | ◐ | US8 | Local date as a tooltip on the time (as RES did on hover) or an inline label. Post time is a verified anchor; the `ts` attribute and the comment's time element are candidates (the created timestamp is the fallback) |
| styleTweaks | Adapted | ◐ | US8 | Built: colour for visited post links, a line above top-level comments, turning animations off (selectors are candidates). Built-in or Infeasible: navTop, expandos, hideUnvotable, full link flair, flair emoji as text, highlight edited time, colour-blind mode, floating sidebar, post title capitalization (titles live in sealed components or CSS cannot do title/sentence case), hide domain link, scroll subreddit dropdown. Beyond RES: REScue has an opt-in "Old Reddit look" (oldRedditSkin, T154), a look-alike stylesheet for feeds, search results and threads; RES itself had no skin like it |
| betteReddit | Adapted | — | — | Sticky header and full-discussion links are native; open comment/body links in a new tab (linksNewTab), long-address truncation and the scrollbar option (styleTweaks, H1) are built; optional "hide" word on posts (hideLinks, off by default) hides on the account via Reddit's own menu; see res-option-parity.md |
| disableChat | Adapted | ◐ | US8 | Hides chat entry points and the unread badge in the header with a REScue stylesheet (candidate `chrome.chatEntry`). Does not block chat's scripts as RES did: Infeasible |
| userbarHider | Built-in | — | — | Reddit's collapsible navigation |
| usernameHider | Ported | ◐ | US8 | Screenshot mode: masks your name (and listed names) in post and comment author links, with a reversible text swap. Verified signed in 2026-10-15: the header/user-menu never shows your name as light-DOM text (it is inside Reddit's components), so it stays visible there |
| nightMode | Built-in | — | — | Reddit's dark mode; RES's night-mode scheduling is Deferred (needs flipping Reddit's own theme setting) |
| stylesheet (custom CSS) | Ported | ✓ | US8 | One `<style id="rescue-user-css">`, applied live and removed when off. Subreddit stylesheets and snippet/custom-toggle links: Infeasible |
| subredditStyleToggle | Infeasible | — | — | Modern Reddit has no per-subreddit CSS |
| hover (popup framework) | Adapted | ✓ | US5 | Infrastructure for REScue popups; T147 adds the "Hover popups" settings (open/fade delays, fade time, width, close on mouse-out, per-popup overrides) used by the show-parent popup |
| dashboard (widgets) | Deferred | — | — | Partly built (T147, module `dashboard`, off by default): a REScue panel of link cards for subreddits, users, searches and custom feeds, opened from the menu, the shortcut bar or `#rescue:dashboard`. Still Deferred: the latest posts inside each card (needs post-listing `.json`, not in the contracts list) |

## Comments

| RES module | Status | Built | Story | Notes |
|---|---|---|---|---|
| commentStyle | Adapted | ✓ | H1 | Thread lines are native; comment boxes, rounded corners, a hover border and a reply indent (commentIndent, ±px on nested `shreddit-comment`) are one stylesheet on the light-DOM comment host (off by default; how the box lines up with Reddit's layout needs a live look). |
| commentQuickCollapse | Adapted | ✓ | H1 | Reddit collapses on click; REScue adds RES's scroll-on-collapse (the page scrolls back to a collapsed comment whose top is above the window) and RES's thread-line left-edge colours/width on the light-DOM `div.threadline-strip` |
| hideChildComments | Adapted | ✓ | US6 | Collapse all replies to a top-level comment |
| commentHidePersistor | Adapted | ✓ | US6 | Remembers comments you collapse with Reddit's own `<details>` toggle and re-collapses them on a revisit (verified live 2026-10-15: stored, re-applied after reload, cleared on re-open) |
| commentNavigator | Adapted | ✓ | US6 | OP/mod/friend/tagged/popular/upvoted |
| commentDepth | Infeasible | — | T149 | Reddit ignores ?depth= on thread links (live 2026-10-16), so the module was removed |
| commentSortBy | Adapted | ✓ | US6 | Default sort via URL `?sort=` added to thread links; verified live: Reddit honours it and card navigation keeps it |
| showParent | Adapted | ✓ | US6 | Parent comment on hover |
| context | Infeasible | — | T148 | Reddit ignores `?context=N` (live 2026-10-16: 3 and 8 give the same page), so the module T146 built to set it was removed. Reddit shows its own "view all comments" link |
| newCommentCount | Adapted | ✓ | US6 | Local visit history; count in the credit-bar slot |
| readComments | Adapted | ✓ | US6 | Local |
| neverEndingComments | Built-in | — | — | Reddit's "more replies" (REScue's `n` key lives in keyboardNav) |
| saveComments (RES-local save) | Adapted | ✓ | US6 | Local snapshot of the body |
| sourceSnudown (view source) | Deferred | — | — | No raw markdown in the page; same-origin item .json (constitution 2.1.0, R20) is a candidate route |
| commentPreview | Built-in | — | — | Reddit's composer previews as you type; RES's Big Editor is Deferred (composer) |
| commentTools | Deferred | — | — | Reddit's toolbar covers formatting; RES's macros, commenting-as, autocomplete and extra shortcuts have no native equivalent and need composer access (Deferred) |
| userHighlight | Adapted | ✓ | US5 | Reddit marks OP; REScue adds moderator (`is-mod-distinguished`, verified), friend and tagged highlights on the author link; admin marker unverified |
| userTagger | Adapted | ✓ | US5 | Tags beside the author link; ignored posts are hidden, ignored comments collapse their own body (replies stay) |

## Users & accounts

| RES module | Status | Built | Story | Notes |
|---|---|---|---|---|
| userInfo (hover card) | Adapted | — | US5 | Reddit's card shows karma and cake day; REScue adds tag / ignore / highlight to post authors' cards (planned, R20) |
| redditUserInfo | Adapted | ◐ | — | As userInfo. Built (T147): opt-in hiding of Reddit's author hover card (one stylesheet rule on the light-DOM card content) with a REScue-menu switch to show it again; REScue's own card is not built |
| showKarma | Adapted | ◐ | H1 | Own post and comment karma as words in the tool strip, read from Reddit's user hover-card partial (R6); off by default. Placement beside the header name is not possible (sealed header). Needs a live check |
| accountSwitcher | Infeasible | — | — | Excluded by Principle V (RES stored passwords); Reddit has native account switching |
| penaltyBox | Ported | ◐ | US1 | Framework built; no feature reports penalties yet |

## Voting & actions

| RES module | Status | Built | Story | Notes |
|---|---|---|---|---|
| voteEnhancements | Adapted | ✓ | US7 | Upvote ratio ("97% upvoted") after the post's time, from the post's `upvote-ratio` attribute (verified live 2026-10-15 on listings and threads). Score colouring is REScue's own chip; highlightScores bolds it. Reddit's own score digits remain inside the closed vote component |
| (vote / save / hide / reply) | Built-in | — | — | Reddit's own controls work directly; keyboard shortcuts press them (US3/US7) |
| submitHelper | Deferred | — | — | |

## Messaging, notifications & moderation

| RES module | Status | Built | Story | Notes |
|---|---|---|---|---|
| orangered | Adapted | — | — | Reddit has an inbox badge; RES's unread count in the tab title/favicon and floating envelope are feasible via same-origin .json reads (constitution 2.1.0; missing) |
| notifications (RES toasts) | Ported | ✓ | US1 | REScue notice framework |
| messageMenu | Deferred | — | — | Reddit has an inbox page but no hover menu of mail links; header anchors are light DOM (R20) |
| quickMessage | Deferred | — | — | Private messages largely replaced by chat |
| modhelper | Deferred | — | — | Mod tools live on mod.reddit.com |
| spamButton | Infeasible | — | — | Old report-as-spam flow no longer exists |

## Summary

| Status | Count |
|---|---|
| Ported | 13 |
| Adapted | 44 |
| Built-in | 9 |
| Deferred | 9 |
| Infeasible | 6 |
| **Total** | **81** |

Merged rows are counted once per RES module (version/announcements/about/RESTips/onboarding = 5
Adapted). The "(vote / save / hide / reply)" row is not an RES module and is not counted.
