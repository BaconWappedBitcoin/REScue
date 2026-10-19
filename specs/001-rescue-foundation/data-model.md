# Data Model: REScue Foundation

Two kinds of data:

- **Page models** are transient, rebuilt from the page on every load and never persisted.
- **Stored entities** are persisted in extension storage; see
  [contracts/storage-schema.md](./contracts/storage-schema.md).

Field sources for page models are defined in [contracts/page-contracts.md](./contracts/page-contracts.md).

---

## Page models (transient)

### Post

| Field | Type | Required | Notes |
|---|---|---|---|
| id | `t3_${string}` | yes | Skip the element if missing |
| title | string | yes | Skip the element if missing |
| permalink | string (path) | yes | Skip the element if missing |
| url | string \| null | | Outbound link for link posts |
| type | `'text'\|'link'\|'image'\|'gallery'\|'video'\|'crosspost'\|'other'` | | Unknown values map to `other` |
| domain | string | | e.g. `self.programming` |
| author | string \| null | | null when deleted |
| subreddit | string | | Without `r/` |
| score | number \| null | | null when hidden |
| upvoteRatio | number \| null | | 0–1 |
| commentCount | number | | |
| created | Date | | |
| flair | { text, bg?, fg? } \| null | | |
| nsfw / spoiler | boolean | | |
| media | MediaDescriptor \| null | | |
| feedIndex | number \| null | | For de-duplication and ranking |
| source | Element ref | | Native element; used only by delegation |

**Validation**: A post missing `id`, `title`, or `permalink` is skipped and counted toward the
`post` contract health. Duplicate ids within a page view are dropped (FR-012).

### Comment

| Field | Type | Notes |
|---|---|---|
| id | `t1_${string}` | |
| postId | `t3_${string}` | |
| parentId | string \| null | Derived from depth stack and position |
| depth | number ≥ 0 | Threading is built from `depth`, never from DOM shape |
| author | string \| null | |
| isOp | boolean | Derived: `author === post.author` (R7) |
| distinguished | `'moderator'\|'admin'\|null` | Optional contract; null until verified (R7) |
| score | number \| null | null if score-hidden |
| created | Date | |
| bodyHtml | sanitized HTML | Scoped to own body: `closest(COMMENT) === el` |
| permalink | string | |
| collapsedByDefault | boolean | |

### MediaDescriptor

`{ kind: 'image'|'gallery'|'video'|'gif'|'embed', items: [{src, width?, height?, caption?}],
dashUrl?, audioUrl?, host }`. Reddit-hosted media only, unless a host adapter for an opted-in host
produced it.

### Session

`{ signedIn: boolean, username: string|null }`. Read from contracts on load and re-checked on route
change; sign-out mid-session flips signed-in-only controls (spec edge case).

### HoverCard (cached, session-scoped)

- **UserCard**: `{ username, found: boolean, displayName?, cakeDay?: Date, postKarma?: number,
  commentKarma?: number, bio?, verified?: boolean, fetchedAt }`
- **CommunityCard**: `{ name, found, description?, weeklyVisitors?: number,
  weeklyContributions?: number, joined?: boolean, fetchedAt }`
- **Lifecycle**: `idle → fetching → ready | notFound | unavailable`. Entries are kept 30 minutes in
  memory, plus a session-storage LRU of 500 entries. `unavailable` triggers a 5-minute global
  back-off (R4).

---

## Stored entities

### SettingsProfile

| Field | Type | Notes |
|---|---|---|
| schemaVersion | integer | Migrations on startup |
| modules | `Record<ModuleId, { enabled: boolean, options: Record<string, OptionValue> }>` | Only non-default values stored |
| keybindings | `Record<CommandId, KeyChord[]>` | |
| syncEnabled | boolean | When true, the profile is mirrored to `storage.sync` |

**Validation**: Option values are checked against the module's declared option schema on load.
Invalid values are reset to defaults with a notice.

### UserTag

`{ username (lower-cased key), displayName, text?, color?, link?, votesUp: integer,
votesDown: integer, voteTally: integer (always votesUp − votesDown), ignored: boolean, updatedAt }`.
Never pruned. Records saved before 2026-10-15 carried only `voteTally`. On load, a positive tally
becomes `votesUp` and a negative one becomes `votesDown`. The RES importer keeps RES's separate
`votesUp`/`votesDown`.

### FilterRule

`{ id, type: 'keyword'|'subreddit'|'domain'|'user'|'flair'|'nsfw', pattern: string,
isRegex: boolean, scope: { mode: 'everywhere'|'only'|'except', subreddits: string[] },
enabled: boolean }`.

**Validation**: Regex patterns must compile (`/body/flags` syntax). Invalid patterns are
rejected at input with an error message, and at load they are disabled and reported.

### ReadRecord

`{ threadId, lastVisit: Date, commentCountAtVisit: number, seenCommentIds?: compact set }`. Pruned
LRU when there are more than 50,000 threads or the record is older than 90 days (R12).

### SavedComment

`{ commentId, permalink, author, subreddit, bodyHtml snapshot, savedAt }`. Never pruned.

### HiddenState

- `collapsedComments`: Map<commentId, true>, pruned with its ReadRecord.
- `hiddenPosts`: autoHide and penalty data, pruned at 90 days.

### Module health (runtime, not persisted)

`{ moduleId, status: 'ok'|'degraded'|'disabled', failingContracts: string[], lastError? }`. Shown in
the troubleshooter and attached to issue reports.

## Relationships

- A FilterRule and a UserTag(ignored) both act on Posts and Comments in the pipeline before render.
- A ReadRecord is keyed by Post id and drives newCommentCount and autoHide.
- A SavedComment references a Comment by id but stores a snapshot, so it survives deletion.
- The SettingsProfile references ModuleIds from the registry. Unknown ids are kept, not dropped, so
  downgrades do not lose settings.
