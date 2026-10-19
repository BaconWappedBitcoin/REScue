# Quickstart & Validation: REScue Foundation

How to build REScue, load it, and prove each user story works end to end. Models and formats are
defined in [data-model.md](./data-model.md) and [contracts/](./contracts/).

## Prerequisites

- Node.js 22+ (24 tested) and npm
- Chrome 120+ (or Edge or Brave) and Firefox 128+
- Playwright browsers: `npx playwright install chromium firefox`

## Build & load

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` starts WXT and launches Chrome with REScue loaded. Use `npm run dev:firefox` for
Firefox. For a production build, `npm run build && npm run zip` writes per-browser zips to
`.output/`.

## Automated checks

```bash
npm test
```

Runs the unit and fixture suites (Vitest).

```bash
npm run test:browser
```

Runs Playwright against the packed extension (Chromium and the Firefox smoke suite).

```bash
npm run verify:live
```

Runs the live-contract run against `www.reddit.com` and `sh.reddit.com`. It prints per-contract hit
rates and reports `blocked` if a bot challenge is served (never solved).

## Validation scenarios

| # | Story | Steps | Expected |
|---|---|---|---|
| 1 | US1 | Open `/r/programming`, a profile, a thread, on `www.` and `sh.` | Reddit's own layout, never hidden or delayed; REScue gear present; `sh.` behaves like `www.` |
| 2 | US1 | Settings → disable a module → reload | Module stays off; effects gone |
| 3 | US1 | Export → "reset all" → import | All settings, tags, and filters restored (SC-007) |
| 4 | — | *(Withdrawn 2026-10-15: there is no classic layout to turn off)* | |
| 5 | US2 | Add keyword filter, open `/r/all`, scroll | Matching posts hidden before display; counter and "show filtered" work |
| 6 | Principle III | Break a contract in a dev build (e.g. rename a selector in `src/contracts/reddit.ts`) | The affected module disables itself with a notice; Reddit stays fully usable |
| 7 | US3 | j/k past the end of a listing; type "j" in a comment box | Selection outline moves; Reddit loads more and the selection continues; typing is unaffected |
| 8 | — | *(Withdrawn 2026-10-15: inline media is Built-in)* | |
| 9 | US5 | Tag a user; ignore a user; open a thread with an AutoModerator comment | Tag beside every instance of the name, on one line with it; ignored comment body collapsed, replies still shown; AutoModerator highlighted |
| 10 | — | *(Withdrawn 2026-10-15: community hover cards are Built-in)* | |
| 11 | US6 | Visit thread, leave, return after new replies | New comments marked; listing shows "(N new)" |
| 12 | US7 | Signed in: select a post and a comment, press the upvote and save keys; reload | All persisted; REScue reported success only after Reddit showed it |
| 13 | US7 | Signed out: press the upvote key on a selected post | "Sign-in required"; score unchanged |
| 14 | US8 | Enable username hiding; add custom CSS | Signed-in username masked everywhere; custom CSS applied |
| 15 | SC-006 | Playwright: record hosts contacted on 5 pages with REScue disabled, then enabled (default settings) | No host appears only in the enabled run |
| 16 | FR-008 | Open an 18+ subreddit; then a page showing the login wall, with "remove login wall" off, then on | REScue 18+ notice with Continue, no auto-confirm; login wall left alone when off, hidden when on; no log-in/sign-up click ever |
| 17 | FR-001 | Open a custom feed and a search results page | Filters, tags and keyboard navigation work on both |

## Hover-card endpoint smoke check

Re-run the research R4/R5 probe (logged out):

```bash
curl -s -H "Accept: text/vnd.reddit.partial+html, text/html;q=0.9" https://www.reddit.com/svc/shreddit/user-hover-card/spez
```

Expect a fragment of roughly 8 KB containing `data-testid="user-hover-card"`, `cake-day`, and
`karma-number`. A response over 100 KB means the fragment header stopped working, so the full-page
fallback will be in use.
