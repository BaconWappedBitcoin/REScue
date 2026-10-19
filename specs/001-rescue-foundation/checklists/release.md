# Release validation — quickstart scenarios (T121)

**Run**: 2026-10-15, Chrome (Playwright Chromium with the built extension). The signed-in runs used
a profile where the user passed Reddit's challenge and signed in by hand; REScue settings were
snapshotted before and restored after (verified identical). The logged-out runs used fresh profiles
until Reddit started serving a bot challenge to automated browsers. **Firefox**: run 2026-10-16 with `tests/live/firefox-smoke.ts` (geckodriver + selenium-webdriver,
temporary add-on in a fresh logged-out profile; see the Firefox section below), a subset of the scenarios.

| # | Scenario | Chrome | Firefox | Evidence |
|---|---|---|---|---|
| 1 | Listing, profile and thread on `www.` and `sh.` | ✅ | ◐ | Gear present, 27 posts / 100 comments, nothing hidden, page never blanked, on both hosts (signed in). **Firefox**: listing only, logged out, www. and sh.: REScue button present, 27 posts each, no REScue console errors |
| 2 | Disable a module → reload | ✅ | ☐ | singleClick off: `[l+c]` 27 → 0 after reload |
| 3 | Export → reset → import | ✅ (fixture) | ◐ | Browser and unit tests (backup.test, us1-settings.spec); not repeated live. **Firefox**: Export from the console downloads `rescue-backup-*.json` (reset and import not run) |
| 4 | *(Withdrawn: no classic layout)* | — | — | |
| 5 | Keyword filter on `/r/all` | ✅ | ✅ | Post with the keyword hidden, banner "1 post filtered · show". Filtering of newly loaded batches is covered by us2-filters.spec; the live scroll only loaded one more post. **Firefox**: rule "the" hid 13 of 28, banner "13 posts filtered · show", "show" revealed a post with chip "Filtered: keyword: the" |
| 6 | Broken contract → module disables, Reddit usable | ✅ (fixture) | ☐ | registry/notices unit tests; `npm run test:mutate` |
| 7 | j/k, past the end, typing in a box | ✅ | ◐ | Live: j/k move the outline; Reddit loads more and the selection continues (27 → 49 posts, earlier live run); text-field passthrough in us3-keynav.spec. **Firefox**: j, j then k moved the outline between posts (past the end and typing not run) |
| 8 | *(Withdrawn: inline media is Built-in)* | — | — | |
| 9 | Tag, ignore, AutoModerator highlight | ✅ | ◐ | Live on www. and sh. (tag after the name, ignored comment body collapsed with replies shown, mod highlight). **Firefox**: a tag typed in the editor showed after the author and survived a reload (ignore and mod highlight not run) |
| 10 | *(Withdrawn: community hover cards are Built-in)* | — | — | |
| 11 | New comments since last visit | ✅ | ☐ | Live: 27 "new" markers after backdating the visit; listing showed "(7 new)" |
| 12 | Signed in: vote and save keys | ✅ | ☐ | Live on a post: `a` upvoted via Reddit's button, persisted after reload, `a` cleared it, persisted. Comment voting live (2026-10-16, t1_pgwkfku in r/science): `a` upvoted via Reddit's button (aria-pressed true within ~50 ms, no failure notice), `a` again 1.5 s later cleared it, reload showed no vote. The first attempt found that the action row's `vote-state` stays stale until reload; confirmation now uses the buttons only (89681d8). Reply/edit keys built (T136–T139), not run live |
| 13 | Signed out: vote key | ✅ (fixture) | ☐ | us7-actions.spec: "Sign in to Reddit to vote.", no click |
| 14 | Username hiding; custom CSS | ◐ | ☐ | Custom CSS applied live (outline rgb(1, 2, 3)) and removed. Username hiding covers author links (fixture-tested); the signed-in header shows the name inside Reddit's components, which REScue cannot reach |
| 15 | SC-006 hosts disabled vs enabled | ✅ (fixture) | ☐ | privacy.spec: identical host sets; the service worker made no requests |
| 16 | 18+ notice; login wall off/on | ✅ (fixture) | ☐ | us1-interstitials.spec. Not repeated live: the signed-in account does not get the gate or the wall |
| 17 | Custom feed and search results | ✅ search / ☐ feed | ☐ | **Search (T133, live signed in on www. and sh., `/search/?q=science&type=posts`)**: a keyword filter hid its result with reason and the "1 post filtered · show" banner; a user tag showed inline after the time in the result's credit row and was the top element at its own point (clickable over Reddit's full-card title link); localDate inline label on every result; `j`, `j`, `k` moved the outline result 1 → 2 → 1; endless scroll loaded 7 → 35 results, all processed and labelled; no REScue console errors; page never blanked (research R19). Upvote ratio does not apply: results carry none. Custom feed not run (no feed link found) |

## Live smoke test (T140, 2026-10-16)

`tests/live/smoke-live.ts`, signed in, Chrome, light and dark × 1280 and 820, www. and sh., after T135–T139 were merged. Reddit never challenged the browser.

| Issue group | After T135–T139 | After the smoke fixes |
|---|---|---|
| Issues overall (first run before T135: 21 triaged, 6 major) | 417 rows | 147 rows, all info except the Escape defect below (fixed after) |
| Corner gear / menu not reachable | 108 rows, harness drift: the gear is replaced by the header "REScue" button | harness drives the header button, gear only as fallback |
| Thread tools / navigator / sub filter toggle "not found" | 39 rows, harness drift: now menu rows, navigator hidden by default | checked as menu rows; navigator checked after enabling it |
| Feature steps failed | ≈35, consequence of the above | 0 |
| Shortcut bar and its menu past the right edge at 820 | 10 | 0 (`100vw` counted the scrollbar; menus clamped) |
| "Covered by a" on post controls | 38, harness false positive | 0 (REScue's own fixed bar over scrolled posts; the check now ignores REScue surfaces) |
| Contrast: tag chip 3.44:1, vote tally 1.66–3.09:1 | 10 | 0 (text colour chosen by contrast) |
| `Alt+/` did not focus search | 2 | 0 (search is a textarea in the header search component's open shadow root) |
| Comment links clipped at 820 (first run #14) | open | fixed (meta row wraps) |
| Thread credit row clipped at 820; console tables scrolled sideways at 820; Escape did not close the tagged-users list with an item selected | found in the rerun | fixed |

Final full Playwright suite on the merged tree: 180 tests; 178 passed in the full run and the 2 failures (parity-menu "sort shorthand", parity-usertagger "vote counted once") passed when rerun alone (load flakes). 884 unit tests and both builds pass. The last fix (Escape) was confirmed live only in a features-only light/1280 run, not the full matrix.

## REScue extras, live (2026-10-16, Chrome, signed in, read-only)

| Feature | Result | Evidence |
|---|---|---|
| Hide promoted posts (T141) | ✅ | r/science 6/6 feed ads hidden, banner "6 promoted hidden", 49 posts untouched; sh. home 4/4; thread page 1/1; show/hide works. A rendered sidebar ad was never seen (slot empty in every sample) |
| Neutrality filter (T142) | ✅ | right=mid on r/Conservative: 19 hidden, 0 mismatches against the data; left=mid on r/politics: 5 hidden, 0 mismatches; max/max on r/news and r/worldnews: apnews.com and reuters.com links (17) never hidden; text posts, reddit media and x.com never hidden; thread post labelled, not hidden; sh. r/Conservative 12/13, 0 mismatches |
| Audience-lean chips (T143) | ✅ | r/politics 28/28, r/Conservative 17/17 scored, r/news 23/23 and sh. r/news 24/24 chips with the expected word, 0 mismatches; unscored domains got none; contrast ≥ 4.62:1; top element, not clipped, light/dark × 1280/820; hover text names domain, score, "not a rating of its content" and the source. Live toggling works from the settings console (a direct storage write does not notify open pages, by design) |

## Firefox, live (2026-10-16, logged out, read-only)

Automated by `tests/live/firefox-smoke.ts` (`npm run smoke:firefox -- --browser librewolf|firefox`): geckodriver 0.37.1 + selenium-webdriver, the built `.output/firefox-mv3` installed as a temporary add-on in a fresh profile, a `moz-extension://` page used to read and write extension storage. Reddit never challenged either browser. LibreWolf 158.0 (with its bundled uBlock Origin) and Firefox 152.0.1 gave the same result on every check.

| Check | LibreWolf 158.0 | Firefox 152.0.1 | Evidence |
|---|---|---|---|
| Install, content script, no REScue console errors (www., sh.) | ✅ | ✅ | REScue button present, 27 posts each, 0 REScue errors over the run |
| Menu and settings console; follows Reddit's light and dark theme | ✅ | ✅ | 10 menu rows; console background white, then rgb(14,17,19) with `theme-dark`, then white again |
| Keyword filter, banner, "show", reason | ✅ | ✅ | 13 of 28 hidden, banner "13 posts filtered", reason "Filtered: keyword: the" |
| j/k outline | ✅ | ✅ | `[data-rescue-selected]` and `#rescue-selection` moved with j, j, k |
| User tag beside author, persists after reload | ✅ | ✅ | chip "ffsmoke" before and after reload |
| inlineMedia words | ✅ | ✅ | 28 containers collapsed, "show gallery (6)", "show image"; click gives "hide gallery (6)" |
| Neutrality lean chips (background reads the bundled data file) | ✅ | ✅ | 22 and 24 chips on 27 posts, valid words, numbers agree with words |
| Hide promoted posts | ✅ (0, uBlock) | ✅ (4 hidden) | LibreWolf: the 4 `shreddit-ad-post` had no box (uBlock), REScue counted 0, correct. Firefox without uBlock: "4 promoted hidden" banner |
| Export from the console | ✅ | ✅ | `rescue-backup-20261016.json` downloaded (format, formatVersion, schemaVersion, exportedAt, app, data) |

Not covered: signed-in scenarios, custom feed, reset and import, ignore and AutoModerator highlight, new-comment marks, past-the-end j/k. No Firefox-specific REScue bug was found; the MV3 event-page background reads the bundled `neutrality-scores.json` fine.

## Gap builds T144–T148, live (2026-10-16, Chrome, signed in, read-only)

| Area | Result | Evidence |
|---|---|---|
| Media viewer (T145) | ✅ | `=`/`-` resize and Ctrl+arrows move Reddit's media box (inner picture follows); maxWidth caps; gallery filmstrip (carousel images are light DOM); plain video player plays the packaged mp4 with an audio track (6 of 17 videos carry one; the rest keep Reddit's player); "show picture" on i.redd.it links in comments; text and comment height caps; original "W × H" from /api/info.json matched Reddit on 19/19 r/pics posts (after T148) |
| Comment and appearance tweaks (T146) | ✅ | Title case via `shreddit-post [slot="title"]`; comment boxes, rounded, hover border only on the innermost hovered comment (after T148); jump to comment box; username on hover; karma numbers; selected-entry line and fill |
| Filters, navigator, commands (T144) | ✅ | Custom condition `score<50 and not domain:reddit.com` hid 10/27 with reason; "only when browsing" limited a rule to r/pics; `vote:` reads vote state; `.` then `nav op`, `fp`, `fl`, `tag test` (removed after); `post science test` opened Reddit's submit page with the title prefilled — not submitted |
| Shortcut bar, hover, dashboard, misc (T147) | ✅ | Last-visited sort and dropdown delays; author card hidden and restored from the menu; profile "search u/name in r/…"; profile section links; dashboard panel; REScue off in one tab and back; notice fade and hover-to-restore, notices above the settings console (after T148) |
| Feed pause (T147, fixed in T148) | ✅ | Paused: 0 load requests while scrolling on r/science, home and a profile (www. and sh.); each "load more" = exactly 1 page; markers Page 2, 3, 4; pauseAfterEvery=2 shows the button after the 2nd page; end-of-feed notice on short feeds |
| `?depth=` / `?context=` links | retired | Reddit ignores both (live, several values); options removed in T148, parity rows OB |
| Not live-checked | — | Settings sync pull (needs two profiles); scroll styles for jumps; live updates of keyboard options |

Full suite after T148: 1023 unit tests; 212 browser tests, 210 in the full run and the 2 failures (parity-menu "?", us7-actions signed-out vote) passed when rerun alone; both builds pass. Comment voting: fixed in 89681d8 (confirm from Reddit's buttons; the row's `vote-state` is stale until reload) and re-run live: PASS (see scenario 12). T149 retired commentDepth (Reddit ignores `?depth=`).

**Open before 1.0**: the rest of the Firefox pass (signed-in scenarios, 2, 6, 11, 13-17); store icons, screenshots and a public privacy-policy URL (docs/store-listing.md).
