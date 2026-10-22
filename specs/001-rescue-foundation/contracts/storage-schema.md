# Contract: Storage Schema & Export Format

## storage.local keys

| Key | Value | Pruning |
|---|---|---|
| `schema` | `{ version: number }` | — |
| `settings` | SettingsProfile ([data-model.md](../data-model.md)) | never |
| `userTags` | `Record<lowercaseUsername, UserTag>` | never |
| `filters` | reserved; filter rules live in `settings.modules.filteReddit.options.rules` (US2), so they are edited by the console and included in settings sync | never |
| `subredditTags` | reserved; subreddit tags live in `settings.modules.subredditTagger.options.tags` (US2) | never |
| `savedComments` | `Record<commentId, SavedComment>` | never |
| `read` | `Record<threadId, ReadRecord>` | LRU >50,000 or >90 days |
| `collapsed` | `Record<commentId, 1>` | with its thread's ReadRecord |
| `hiddenPosts` | `Record<postId, timestamp>` | >90 days |
| `threadSubscriptions` | `Record<postId, Sub>` (threadSubscriptions); written at once, not debounced. Before 2026-10-21 it was the raw key `rescue-subs:threadSubscriptions`, which the module moves here once and deletes | each watch ends after its chosen days |
| `mod:<moduleId>` | module-private scoped store | module-declared |

All writes go through typed stores that debounce (250 ms) and batch. A failed write keeps its
values for the next write (newer values win) and is reported once; removing keys drops pending
writes to them first, so a queued write cannot bring them back.

## storage.sync (optional)

Only `settings` is synced, split into `settings.0..n` chunks of ≤7 KB each, plus a `settings.meta`
key holding `{ chunks, hash, version }`. A chunk set whose hash does not match is ignored and the
local profile wins. Tags and filters are excluded because sync quotas are too small for RES-scale
data. They travel through the export file instead.

The other direction (T147): when the synced copy changes on another device and sync is on, the background compares hashes and either asks (default; `backupAndRestore.warnBeforeAutomaticRestore`) or applies it. It keeps `syncState: { knownHash, pendingHash }` in `storage.local` (not exported) so a copy this device wrote, applied or declined is not asked about again. Before applying a synced copy it saves this device's previous settings as `settingsBeforeSync: { at, previous }` (not exported), so a bad copy can be undone by hand.

## Migrations

`migrations/NNN-description.ts` exports `up(data) → data`. They run in order at background startup,
on a copy, and the result is written in one `set`. A failed migration leaves the data untouched and
shows a notice offering an export.

## Export file (`rescue-backup-YYYYMMDD.json`)

```json
{
  "format": "rescue-backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "exportedAt": "2026-10-15T12:00:00Z",
  "app": { "name": "REScue", "version": "x.y.z" },
  "data": { "settings": {}, "userTags": {}, "filters": [], "subredditTags": {},
            "savedComments": {}, "read": {}, "threadSubscriptions": {} }
}
```

- Import validates `format` and `formatVersion` and runs migrations from `schemaVersion`. It then
  replaces or merges, as the user chooses. It never executes content and caps the file at 50 MB.
- `read` is optional in exports (a user toggle) because of its size.

## RES import (stretch, not required for 1.0)

The RES backup format includes `RESmodules.userTagger.tags` and filteReddit options. A best-effort
importer maps user tags and filters only, and reports anything it skipped.
