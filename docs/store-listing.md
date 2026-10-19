# Store listing: Chrome Web Store and Firefox Add-ons (AMO)

Text for the two store submissions. Keep it in step with `PRIVACY.md` and
`specs/001-rescue-foundation/feature-matrix.md`; the privacy answers below are copies of the policy.

## Packages

```bash
npm run build && npm run zip
```

| File                                   | Goes to                                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `.output/rescue-<version>-chrome.zip`  | Chrome Web Store                                                       |
| `.output/rescue-<version>-firefox.zip` | AMO                                                                    |
| `.output/rescue-<version>-sources.zip` | AMO "source code" upload (AMO asks for it because the code is bundled) |

AMO build notes for reviewers: Node 22 or newer, `npm ci`, then `npm run build:firefox`. The result
is `.output/firefox-mv3/`.

## Title

REScue: Reddit Enhancement Suite for modern Reddit

(Chrome allows 75 characters; this is 50. The name "Reddit Enhancement Suite" is used descriptively.
The listing must also say that REScue is independent; see the disclaimer below.)

## Short description

Chrome (132 characters at most):

> Filters, keyboard navigation, user tags and comment tools for Reddit, added to Reddit's own page. No tracking, no servers.

AMO summary (250 characters at most):

> Brings Reddit Enhancement Suite style tools to modern Reddit: post filters, keyboard navigation, user tags, comment tools and a settings console. It decorates Reddit's own page, keeps everything on your device, and sends nothing anywhere.

## Long description

REScue brings the useful parts of Reddit Enhancement Suite (RES) to modern Reddit (www.reddit.com
and sh.reddit.com). It works on Reddit's own page. It adds to the page and never replaces it, so
if something on Reddit changes, Reddit keeps working and the affected REScue feature turns itself
off with a notice.

What REScue provides:

- **Old Reddit look** (opt-in). Feeds, search and threads look like old.reddit.com: a vote column
  with rank numbers, small thumbnails, blue titles with (domain), old taglines, the flat
  "comments share save hide report" row, sort tabs, green pinned posts and old comment heads. Every
  vote and button press goes through Reddit's own controls.
- **Filters.** Hide posts by keyword, subreddit, domain, user, flair or NSFW, and collapse or hide
  comments by keyword, user, score or depth, with a banner showing what was hidden and a way to
  reveal it. Optionally hide promoted posts and "Suggested communities".
- **Low-effort reply filter** (on by default, can be switched off). Replies that only agree, such
  as "This!", "100%", "I agree" or "Exactly", are collapsed; the replies under them stay visible.
- **Neutrality filter** (opt-in). A chip on news links shows who shares the domain, from blue
  (left-leaning audience) to red (right-leaning audience). You can also hide domains at the far
  ends, with separate strictness for each side. Scores come from two bundled, CC0-licensed
  research datasets; nothing is looked up online.
- **Keyboard navigation.** j/k to move between posts and comments, Enter to open, a/z to vote,
  s to save, h to hide, go-to shortcuts, a command line and a "?" help overlay. Each action presses
  Reddit's own button and says so if Reddit did not confirm it.
- **User and subreddit tags.** Tag, colour, highlight and ignore people (with an ignore button on
  posts and comments), and keep a vote tally.
- **Comment tools.** A comment navigator, remembered collapsed comments, hiding child comments,
  "show parent" previews, sortable tables, comments saved on this device, a new-comment count and
  thread subscriptions.
- **Feed tools.** Auto-hide read posts, pause endless scrolling or load the next page sooner, wheel
  browsing, a media viewer and inline-media hiding.
- **Appearance.** A subreddit shortcut bar, a logo link, local date and time, custom CSS, style
  tweaks, a username hider for screenshots and a back-to-top button.
- **Settings console** with search, presets, quick toggles, a troubleshooter, and backup, restore
  and import from a RES backup file (user tags and filters; it lists what it skipped).

What REScue does not do, because modern Reddit already does it (the full list is in the feature
matrix): endless scrolling, inline images, galleries and video, crosspost cards, spoiler tags, and
community hover cards. Some RES features cannot be done on modern Reddit at all, for example comment depth and context
links, because Reddit ignores them. A few features
(search helper, logo link, shortcut bar) depend on parts of Reddit's page that may change, and are
marked as such in the settings console.

Privacy: no accounts, no analytics, no telemetry, no servers. REScue's own requests are read-only
and go only to the Reddit page you are on, for the few features that need them. Your tags, filters
and settings stay in your browser. Details are in the privacy policy.

REScue never asks for, stores or sends your Reddit password or tokens, and never logs you in.

REScue is an independent open source project (GPL-3.0-or-later). It is not made by, or affiliated
with, Reddit, Inc. or the authors of Reddit Enhancement Suite.

## Single purpose

Add user-selectable reading, filtering and navigation tools to Reddit's website (reddit.com).

## Permissions justification

| Permission                                                                                   | Why                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                                                    | Keeps your settings, tags, filters, saved comments and read history in the browser's extension storage on this device. With sync turned on, the settings profile is mirrored to browser sync storage.                                                                                  |
| `unlimitedStorage`                                                                           | Tag, filter and read-history lists can grow large over years of use; this stops the browser from evicting them. Nothing is stored remotely.                                                                                                                                            |
| Host access: `*://www.reddit.com/*`, `*://reddit.com/*`, `*://sh.reddit.com/*`               | The tools run on, and only on, these Reddit pages. No other site is accessed.                                                                                                                                                                                                          |
| `declarativeNetRequest` (Chrome, optional) / `declarativeNetRequestWithHostAccess` (Firefox) | Only for "Block media downloads" (Hide inline media): stops Reddit's media files from downloading. Chrome asks when the option is turned on; Firefox's variant can only act on hosts the user also granted.                                                                            |
| `scripting`                                                                                  | If a Reddit tab finishes loading without REScue running in it (seen in some Firefox builds when a page is opened directly), the background starts REScue's own packaged content scripts in that tab. It runs only on the Reddit pages above and never injects code from anywhere else. |
| Optional host access: `*://*.redd.it/*`                                                      | Asked for only when "Block media downloads" is turned on, so the rule above can apply to Reddit's media host.                                                                                                                                                                          |

Not requested: `tabs` (the background worker opens link tabs through the tab-creation call, which
needs no permission), `activeTab`, `cookies`, `webRequest`, `history`, `identity`, any optional or
external host. Not used: remote code, `eval`, analytics SDKs. All code ships in the
package.

Also declared: a small content script on `old.reddit.com` that moves you to the same page on
`www.reddit.com` (switchable in settings). Declared content scripts need no host permission.

## Privacy practices (store dashboard answers)

Same as `PRIVACY.md`.

- **Data collected:** none. In the Chrome "Data usage" form, leave every category unticked. In
  Firefox the manifest declares `data_collection_permissions: { required: ["none"] }`.
- **Data sold or transferred to third parties:** none.
- **Data used for unrelated purposes or creditworthiness:** none.
- **Remote code:** none.
- **Network requests by the extension:** read-only GET requests to the Reddit page's own origin,
  only for the features listed in `PRIVACY.md` (for example "my subreddits" in the shortcut bar and
  thread subscriptions), and only when those are used. No other host.
- **Credentials:** never handled. REScue presses Reddit's own buttons; Reddit's page makes the
  requests with your own session.
- **Privacy policy URL:** publish `PRIVACY.md` at a stable address (the repository's rendered file
  is enough) and enter that URL in both dashboards.
- **Verification:** `tests/browser/privacy.spec.ts` compares the hosts contacted on five Reddit page
  types with and without REScue and fails if REScue adds one.

## Built-in versus provided

The store text above deliberately separates what REScue provides from what Reddit already has.
Before each release, re-read `specs/001-rescue-foundation/feature-matrix.md` and remove any claim
that is not marked working (✓) there.

## Still needed before submitting

- Icons: done (`public/icon/`, from `docs/brand/icon.svg`). The 128 px file doubles as the store
  icon.
- Screenshots: done. `docs/screenshots/store/*-1280x800.png` (Old Reddit look feed and thread,
  keyboard help, Reddit's own layout with REScue), taken signed out with names de-identified.
  Chrome takes up to five; AMO accepts the same files.
- The privacy policy published at a URL:
  https://github.com/BaconWappedBitcoin/REScue/blob/main/PRIVACY.md once the repository is public.
- Developer accounts: the Chrome Web Store (one-time registration fee) and addons.mozilla.org
  (free), both created by the owner.
