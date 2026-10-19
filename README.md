<p align="center">
  <img src="docs/brand/icon-512.png" alt="REScue: a life ring around an upvote arrow" width="128" height="128">
</p>

<h1 align="center">REScue</h1>

<p align="center">
  <strong>Reddit Enhancement Suite, rescued for modern Reddit.</strong><br>
  Filters, keyboard navigation, user tags, comment tools, an Old Reddit look, and more,
  on today's www.reddit.com and sh.reddit.com, in Chrome and Firefox.
</p>

---

Reddit Enhancement Suite (RES) made Reddit better for over a decade, but it was written for
old.reddit.com, and on today's Reddit it does nothing. REScue brings its useful parts back to the
Reddit you actually get now: the same ideas, rebuilt from scratch for Reddit's current page.

REScue **adds to Reddit's own page and never replaces it**. When Reddit changes something, Reddit
keeps working, and the REScue feature that depended on it switches itself off with a notice
instead of breaking the page.

## Highlights

- **Old Reddit look** (opt-in): feeds, search and comment threads restyled like old.reddit.com.
  You get the vote column with rank numbers, small thumbnails, blue titles with `(domain)`,
  "submitted 2 hours ago by user to r/sub", the flat `comments share save hide report` row, sort
  tabs, green pinned posts, and old-style comment heads. It appears from the first paint, with no
  flash of the new design. Every vote and button press goes through Reddit's own controls.
- **filteReddit**: hide posts by keyword, subreddit, domain, user, flair or NSFW. A banner says
  what was hidden and lets you reveal it.
- **Neutrality filter** (opt-in): an optional chip on each news link showing who shares that
  domain, coloured from blue (left-leaning audience) through grey to red (right-leaning audience).
  You can also hide far-left and far-right domains, with separate strictness for each side. Scores
  come from two published, CC0-licensed research datasets bundled with the extension. Nothing is
  looked up online.
- **Keyboard navigation**: `j`/`k` to move between posts and comments, `Enter` to open, `a`/`z` to
  vote, `s` to save, `h` to hide, go-to shortcuts, a command line, and a `?` help overlay.
- **User tagger**: tag, colour and ignore users, with an *ignore* button on posts and comments and a
  vote tally.
- **Comment tools**: a comment navigator, remembered collapsed comments, hiding child comments,
  "show parent" previews, sortable tables, comments saved on your device, a new-comment count and
  thread subscriptions.
- **Feed tools**: auto-hide read posts, hide promoted posts, hide "Suggested communities", pause
  endless scrolling (or load the next page sooner), wheel browsing, a media viewer and
  inline-media hiding.
- **Settings console** with search, presets, quick toggles, a troubleshooter, and backup, restore
  and **import from a RES backup** (your user tags and filters come with you).

There are about 60 modules in all, grouped as **listings, comments, users, actions, appearance and
core** in the settings console. Each has a plain-language description and per-option explanations.

## Install

**From the stores:** coming soon to the Chrome Web Store and Firefox Add-ons.

**From source** (Node 22 or newer):

```bash
git clone https://github.com/BaconWappedBitcoin/REScue.git
cd REScue
npm ci
npm run build            # Chrome:  .output/chrome-mv3/
npm run build:firefox    # Firefox: .output/firefox-mv3/
```

- **Chrome, Edge or Brave:** open `chrome://extensions`, turn on *Developer mode*, click *Load
  unpacked*, and choose `.output/chrome-mv3`.
- **Firefox or LibreWolf:** open `about:debugging#/runtime/this-firefox`, click *Load Temporary
  Add-on*, and choose `.output/firefox-mv3/manifest.json`. Firefox removes temporary add-ons when
  it restarts.

Then open Reddit. The **REScue** button in Reddit's header opens the menu and the settings console.

## Privacy

REScue has **no accounts, no analytics, no telemetry and no servers**.

- Your settings, tags, filters and history stay in your browser's extension storage. If you turn on
  browser sync, your settings are copied to your browser's own sync.
- Its own network access is limited, in code, to read-only requests to the Reddit page you are on,
  only for the few features that need them.
- It never sees, stores or sends your password or tokens.

Votes, saves, hides and reports are done by pressing Reddit's own buttons, so Reddit's page makes
those requests with your own session, exactly as if you had clicked. The details, including every
address REScue may read, are in the [privacy policy](PRIVACY.md).

## How it works

- **Selectors in one place.** Everything REScue reads from Reddit's page is named in
  [`src/contracts/reddit.ts`](src/contracts/reddit.ts). Each entry is marked *verified* (checked
  against the live site, with a date) or *candidate*, and features check their contracts at
  startup.
- **Read-only toward Reddit's internals.** REScue reads Reddit's open shadow roots but never
  writes into them. Actions press Reddit's own controls and are confirmed by what Reddit's buttons
  show afterwards.
- **Opt-in for anything that changes Reddit's look or hides content.** Skins, hiding and filters
  are off until you turn them on, and every hidden item can be revealed.

## Development

```bash
npm ci
npm run dev             # WXT dev mode
npm test                # unit tests (Vitest, about 1,160)
npx playwright test     # browser tests against fixture pages (about 260)
npm run lint
npx tsc --noEmit
npm run zip             # store packages in .output/
```

The code is TypeScript in strict mode, built with [WXT](https://wxt.dev) for Manifest V3. The
settings console is written in Preact. The specification, plan and the full RES feature-parity
matrix are in [`specs/001-rescue-foundation/`](specs/001-rescue-foundation/).

Bug reports are welcome: open an [issue](https://github.com/BaconWappedBitcoin/REScue/issues).
Please include your browser, the page address, and what you expected to happen. The settings
console's *Troubleshooter* can copy a diagnostics report for you.

## Credits

- [Reddit Enhancement Suite](https://github.com/honestbleeps/Reddit-Enhancement-Suite), by the RES
  contributors (GPL-3.0). It is the inspiration, and where a file ports logic from RES, its header
  says so.
- [Sheddit](https://github.com/kookaburrabarrel/sheddit), by kookaburrabarrel (GPL-3.0).
- The neutrality data:
  - Eady, Bonneau, Tucker and Nagler (2025), *News Sharing on Social Media*, Political Analysis.
    Data doi:10.7910/DVN/1QMLOV, CC0.
  - Robertson et al. (2018), *Partisan Bias Scores for Web Domains*. Data doi:10.7910/DVN/QAN5VX,
    CC0.

The full attribution is in [`NOTICE`](NOTICE).

## License

[GPL-3.0-or-later](LICENSE).

REScue is an independent open-source project. It is not made by, endorsed by, or affiliated with
Reddit, Inc. or the authors of Reddit Enhancement Suite. "Reddit" is a trademark of Reddit, Inc.,
and is used here only to describe what the extension works with.
