# REScue Privacy Policy

REScue has no telemetry, analytics, tracking, accounts, or servers of its own. It collects nothing
and sends nothing anywhere except to Reddit itself, and only for the few features listed below,
only when you use them. It reads and decorates the Reddit page you are already looking at, and
keeps its data on your device.

## What stays on your device

Settings, user tags, filters, saved comments, hidden-post and read history are stored in your
browser's extension storage on this device. The extension asks for the `unlimitedStorage`
permission only so that large tag, filter and read-history lists are never evicted.

- If you turn on **sync**, only your settings profile is copied to your browser account's sync
  storage, which your browser vendor operates (Chrome Sync, Firefox Sync). The profile holds module
  options, which include filter rules and lists you typed into settings. User tags, subreddit tags,
  saved comments, hidden posts and read history are not synced.
- Threads you "subscribe" to are kept in the same storage, each with its title, link and last
  comment count, until the watch ends (2 days by default) or you unsubscribe. They are not synced.
- Tags leave your device only in a backup file you export yourself. Importing a backup
  (REScue's own, or a Reddit Enhancement Suite backup) reads a file you pick; nothing is uploaded.
  The export is handed to your browser's download without ever being placed in Reddit's page, and
  its temporary address is dropped as soon as the download starts.

### Small copies kept in reddit.com's own storage

So that a few looks apply from the very first paint (before REScue's settings can be read), three
features keep a small copy of their choice in reddit.com's `localStorage`. That storage belongs to
the Reddit page, so **Reddit's own scripts can read it**. Each copy holds only what is listed here,
and is removed when the feature is off or back at Reddit's default:

| Key                   | Kept by                                                  | What it holds                                                                                      |
| --------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `rescue:oldSkin`      | Old Reddit look (`appearance/oldSkin/early.ts`)          | That module's own options (which parts of the old look are on, thumbnail size, dark-mode colours)  |
| `rescue:commentMedia` | Hide inline media (`listings/inlineMedia/earlyStyle.ts`) | Whether comment media is hidden, and the subreddit names you set to always show or always collapse |
| `rescue:frontSort`    | Logo link, front page sort (`appearance/logoLink.ts`)    | The sort you chose for the front page (hot, new, top or rising)                                    |

Nothing else of yours (tags, filters, history, other settings) is ever written there.

## Network requests REScue makes

All of REScue's code that could send a request goes through one function (`src/core/net.ts`), and
it permits exactly one kind of destination: Reddit's own origin (`www.reddit.com` or
`sh.reddit.com`, the page you are on), carrying your existing Reddit session. Any other
destination is refused, and `oauth.reddit.com` in particular is never used. REScue never loads
images, scripts, frames, fonts or media from any host, and its background worker makes no
requests.

Every request is a **read-only GET** (REScue never sends a POST, PUT, PATCH or DELETE; `net.ts`
refuses any other method, and any request body, before anything leaves). If Reddit answers with a
redirect to any other site, the answer is thrown away unread. Requests are made only
when the feature that needs it is used, and never more than once a second per address. The pages
it may read are these, and nothing else:

| Address (on the page's own origin)                                           | What it reads                                                                                        | When                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/svc/shreddit/user-hover-card/…` and `/svc/shreddit/community-hover-card/…` | Reddit's own hover-card fragments for a user or community                                            | Only by code that shows a user or community card; not connected to anything in this version                                                                                                           |
| `/subreddits/mine.json`                                                      | The subreddits you subscribe to (name, link, subscriber count)                                       | Only when you press "my subreddits" in the shortcut bar; one request per 100 subscriptions, kept in memory for about an hour                                                                          |
| `/comments/<post>.json?raw_json=1&limit=1&depth=0`                           | The comment count of each thread you chose to "subscribe" to (one request per thread, just the post) | Only if you subscribed to at least one thread; about every 10 minutes while a Reddit tab is open (one tab does it, not all), at most 25 threads a round (more are taken in turn over the next rounds) |
| `/comments/<post>.json?raw_json=1&limit=1&depth=0`                           | The raw Markdown text of the text post whose "source" word you clicked ("Show source")               | Only when you click "source" while signed in; one request per click (a repeat click within a minute reuses the answer)                                                                                |
| `/comments/<post>/_/<comment>.json?raw_json=1&limit=1&depth=1`               | The raw Markdown text of the one comment whose "source" word you clicked ("Show source")             | Only when you click "source" while signed in; one request per click (a repeat click within a minute reuses the answer)                                                                                |
| `/comments/<post>.json?raw_json=1&limit=1&depth=0`                           | A picture post's original pixel size (for "Display original resolution" in the media viewer)         | Only while that option is on, for the pictures it labels; one request per post, asked once                                                                                                            |
| `/api/me.json`                                                               | Which account you are signed in as                                                                   | Reserved; no feature uses it in this version                                                                                                                                                          |
| `/prefs/blocked.json`                                                        | The users you blocked on Reddit                                                                      | Only when you press "Import Reddit's blocked users as ignored" and then confirm; Reddit's own block list is never changed                                                                             |
| `/api/multi/mine.json`                                                       | Your custom feeds (name and address of each)                                                         | Only when you open "feeds ▾" in the shortcut bar (signed in); one request, kept in memory for about an hour                                                                                           |

What REScue reads this way is used on your device and is not sent anywhere. The lists of
subscribed threads (with their last comment count) are stored only on this device. If Reddit
answers one of these requests with a refusal (403) or with a web page instead of data, REScue
stops asking that address for 10 minutes and tells you so; if Reddit says REScue asks too often
(429), it stops asking for anything for 10 minutes. Reddit's `/api/info.json`, which earlier
versions read, is no longer asked for: since 2026-10-21 Reddit refuses it (403) even to signed-in
readers. If Reddit changes the format of an answer,
REScue shows a warning and turns that feature off rather than guess. Signed out, these features
are disabled with a "sign in" hint.

An automated test (`tests/browser/privacy.spec.ts`) opens five kinds of Reddit page with and
without REScue and fails if REScue adds any host that Reddit's own page does not already contact.

## Things that happen because you asked

- **Opening links.** The "open in new tab" shortcuts, the command line (`/r/…`, `/u/…`, search) and
  the keyboard navigation open or go to the page you chose, including a post's external link. That
  is an ordinary browser navigation to a page you picked, not a request REScue makes for itself.
- **Votes, saves and other actions.** REScue clicks Reddit's own buttons for you. Reddit's page then
  talks to Reddit exactly as if you had clicked. REScue never sees or copies your session cookies or
  tokens.
- **old.reddit.com links.** On `old.reddit.com` (unless you turn the option off) REScue changes the
  address to the same page on `www.reddit.com`. Both are Reddit.

## Optional: blocking media downloads

Off by default. The "Hide inline media" feature can hide the images, galleries and video in posts.
Hiding does not stop pictures from downloading, so there is a second switch, "Block media
downloads". If you turn it on, your browser asks you for two optional permissions:
`declarativeNetRequest` and access to `*.redd.it` (Reddit's media servers). With them, REScue asks
the browser to refuse image, media and background loads from `preview.redd.it`,
`external-preview.redd.it`, `i.redd.it`, `v.redd.it` and `packaged-media.redd.it` when the page
asking is on reddit.com. This **only blocks**: REScue sends no request, reads no content and shares
nothing. The blocking applies to every Reddit tab until you turn the switch off (or choose "Allow in
this tab"), and turning it off removes the rule. You can also take the permissions back in your
browser's extension settings. The list of posts whose media you showed (so they stay shown) is kept
on this device only and forgotten after 90 days.

## Optional: the neutrality filter

Off by default. It can show a left/neutral/right chip on, and hide, link posts by comparing each post's link domain with a list of
audience-partisanship scores (Eady et al. 2025 for about 180 major outlets and Robertson et al.
2018 for the rest, both CC0) that ships inside the extension as a plain data file. The list is read from the extension itself, only when you set one side above
"off" or turn on the lean chips; the file is not web-accessible and no network request is made. Your choices (the left and
right settings and your allow-list of domains) are ordinary module options, stored and synced like
the rest of your settings. Nothing about which domains you see or hide is sent anywhere.

## Requests made by Reddit's own page

Reddit's page makes its own requests, including to advertising and analytics providers. REScue
neither adds nor blocks them, and cannot see their contents. The optional "Hide promoted posts"
feature (off by default) only hides Reddit's promoted posts and ad slots on the page you are
looking at. It stores nothing and makes no requests; Reddit still loads the ads, so it is not an ad
blocker (use one such as uBlock Origin for that).

## Credentials

REScue never asks for, stores, or transmits your Reddit password or any access token.

## Where REScue runs

The extension has access to `reddit.com`, `www.reddit.com` and `sh.reddit.com` only, and requests
no other site access at install. Only if you turn on "Block media downloads" does it ask, as an
optional permission, for `*.redd.it` (see above). It runs a small redirect script on
`old.reddit.com`.

## Changes

If a later version makes any other request of its own, this document is updated in the same release and
the privacy test is extended to cover it.
