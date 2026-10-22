# Contract: Reddit Page Contracts Registry

`src/contracts/reddit.ts` is the **only** file that names Reddit-owned selectors, tag names,
attribute names, header values, or endpoint paths (Principle I). Each entry declares:

```ts
interface PageContract {
  key: string;                  // e.g. 'post.title'
  kind: 'selector' | 'attribute' | 'endpoint' | 'header' | 'text-pattern';
  value: string | RegExp;
  required: boolean;            // required → its absence marks dependent modules degraded/disabled
  hosts?: Array<'www' | 'sh'>;  // per-host override (R9); default both
  verifiedAt?: string;          // ISO date of last live confirmation
  status: 'verified' | 'inherited' | 'candidate' | 'retired'; // retired: Reddit stopped serving it
  probe: LiveProbe;             // how tests/live re-verifies it (page type + expectation)
  usedBy: ModuleId[] | 'core';
}
```

## Initial registry (summary)

| Key | Value | Status | Source |
|---|---|---|---|
| app | `shreddit-app` | inherited | Sheddit |
| feed / post / adPost | `shreddit-feed`, `shreddit-post`, `shreddit-ad-post` | inherited | Sheddit |
| post.* attributes | `id`, `post-title`, `permalink`, `content-href`, `post-type`, `score`, `upvote-ratio`, `comment-count`, `created-timestamp`, `domain`, `author`, `subreddit-name`, `feedindex` | inherited | Sheddit `POST_ATTR` |
| post.nsfw | `nsfw` attribute | inherited | Sheddit |
| post.body | `[slot="text-body"]` | inherited | Sheddit |
| feed.partial | `shreddit-feed faceplate-partial[loading="programmatic"]:not([src*="hover-card" i])` | inherited | Sheddit (R3) |
| feed.empty | `[data-testid="no-content"]` | inherited | Sheddit |
| commentTree / comment | `shreddit-comment-tree`, `shreddit-comment` | inherited | Sheddit |
| comment.* attributes | `thingid`, `postid`, `author`, `score`, `created`, `depth`, `comment-position`, `comment-parent-positions`, `permalink` | inherited | Sheddit `COMMENT_ATTR` |
| comment.body | `[slot="comment"]` (scoped to own element) | inherited | Sheddit |
| comment.partial | `shreddit-comment-tree faceplate-partial[loading="programmatic"]` | inherited | Sheddit |
| comment.scoreHidden | `score-hidden` | candidate | Sheddit (unverified) |
| comment.distinguished | presence attribute `is-mod-distinguished` (admin: `is-admin-distinguished`, unverified) | verified 2026-10-15 (moderator) | R7: AutoModerator comment, r/science |
| session.username | `shreddit-app > after-login-toast-dispatcher[username]` | inherited | Sheddit |
| session.signedIn | `shreddit-app[user-logged-in="true"]`, … | inherited | Sheddit |
| partial.loadMethod | `loadContent` | inherited | Sheddit (bridge only) |
| hover.user.endpoint | `/svc/shreddit/user-hover-card/{name}` | verified 2026-10-15 | R4 |
| hover.community.endpoint | `/svc/shreddit/community-hover-card/{name}` | verified 2026-10-15 | R5 |
| json.info | `/api/info.json` | retired 2026-10-21 (HTTP 403 text/html to a signed-in, same-origin read; nothing uses it) | live check 2026-10-21 |
| json.comments | `/comments/{id}.json`, and one comment's thread `/comments/{post}/_/{comment}.json` (raw_json=1, limit, depth) | verified 2026-10-21 | live check 2026-10-21; replaces json.info for showSource, threadSubscriptions and the media viewer's original size |
| hover.accept | `text/vnd.reddit.partial+html, text/html;q=0.9` | verified 2026-10-15 | R4 |
| hover.user.card | `[data-testid="user-hover-card"]` | verified | R4 |
| hover.user.cakeDay | `time[data-testid="cake-day"]@datetime` | verified | R4 |
| hover.user.karma | `[data-testid="karma-number"]` (label-paired) | verified | R4 |
| hover.community.activeCount | `[data-testid="community-hover-card:active-count"]` | verified | R5 |
| hover.community.number | `faceplate-number@number` (label-paired) | verified | R5 |
| inbox.badge | (to capture) | candidate | R6 |
| ageGate.confirm | (from Sheddit `AGE_GATE`; re-capture) | inherited | FR-008 |
| loginWall.overlay | `#desktop-dynamic-upsell-dialog, desktop-dynamic-upsell-modal` + body class `rpl-scroll-lock` | inherited | Sheddit `NATIVE_UPSELL`; FR-008 |
| search.results / search.post | (to capture) | candidate | FR-001 |
| post.authorLink | `[slot="credit-bar"] [slot="authorName"] a[href*="/user/"]` | verified 2026-10-15 | R17; decorations go after the `authorName` wrapper |
| post.time | `faceplate-timeago` in the post's own credit bar | verified 2026-10-15 | R17; tagline anchor |
| post.slots | `credit-bar`, `title`, `authorName` (light-DOM elements; on listings the post's shadow root has no `credit-bar`/`title` slot) | verified 2026-10-15 | R17 |
| comment.authorLink | `a[href*="/user/"]` in the comment's own `[slot="commentMeta"]` | verified 2026-10-15 | R17 |
| comment.slots | `commentMeta` | verified 2026-10-15 | R17 |
| customFeed.feed | `shreddit-feed` on custom-feed routes (to confirm) | candidate | FR-001 |

## Rules

- Parsing helpers in `src/model/` are the only consumers. They return typed models plus a
  per-contract hit/miss tally, which feeds module health.
- **Label pairing**: when Reddit repeats a testid (karma, faceplate-number), the parser pairs each
  value with its adjacent label text instead of relying on order. A label mismatch yields `undefined`,
  never a mislabelled number (Principle II).
- **Text patterns** (English-only) are allowed only when no attribute exists. They must be flagged
  `text-pattern` and fail safe.
- **Changing a contract** requires updated fixtures plus a live-contract run recorded in
  `verifiedAt` (Development Workflow gate).
