# Contract: Messaging Between Contexts

Three contexts:

- the **isolated content script** (all REScue logic),
- the **MAIN-world bridge** (the only code in the page's JavaScript realm),
- the **background** (storage migrations, permission prompts, sync).

## Isolated ↔ MAIN-world bridge

Transport: `CustomEvent`s on `window` (`rescue:bridge-request` / `rescue:bridge-response`) whose
`detail` is a JSON **string**. Strings cross extension worlds in Chrome and Firefox; objects do not
reliably. Each envelope carries a per-page random channel token, which the isolated script sets as
`data-rescue-channel` on `<html>` at `document_start`; the bridge ignores envelopes without it.
Payloads are plain JSON, with no functions and no DOM nodes. Elements are addressed by a
REScue-stamped `data-rescue-ref`. Implemented in `src/core/bridge-protocol.ts`,
`src/core/bridge-client.ts` and `src/entrypoints/bridge.content.ts`.

| Request | Payload | Response | Notes |
|---|---|---|---|
| `partial.load` | `{ ref }` | `{ ok, error? }` | Calls `loadContent()` (R3) |
| `native.click` | `{ ref, control: 'upvote'\|'downvote'\|'save'\|'hide'\|'reply'\|'join'\|'over18' }` | `{ ok, error? }` | Ensures the native row is laid out first (R10). `over18` is sent only after the user clicks Continue, or when auto-confirm is enabled (FR-008) |
| `native.state` | `{ ref, control: 'upvote'\|'downvote' }` | `{ ok, pressed: boolean \| null, error? }` | Read-only: the control's `aria-pressed` state, waiting up to 1 s for lazily hydrated controls. ActionApi reports a vote `ok` only once this reads back as requested (R10, US7) |
| `composer.insert` | `{ ref, text }` | `{ ok, accepted: boolean }` | Waits until the editor keeps the text |
| `composer.submit` | `{ ref }` | `{ ok }` | Only after `accepted`; caller confirms by observing the posted comment |

Rules:

- Every request times out (default 5 s) and resolves `{ ok: false, error: 'timeout' }`.
- The bridge never reads storage, never fetches, and exposes no general eval.

## Content ↔ background (`runtime.sendMessage`)

| Message | Purpose |
|---|---|
| `settings.changed` | Broadcast to all Reddit tabs so they re-read the profile |
| `backup.export` / `backup.import { json }` | Run in background for migrations and quota handling |
| `health.report` / `health.get` | Collect module health per tab for the troubleshooter |
| `sync.status` / `sync.apply` / `sync.keep` | Settings sync, pull side: ask whether a changed synced copy is waiting, use it, or keep this device's. The background sends `sync.pending` to Reddit tabs when one arrives (T147) |

## Network

Content-script fetches are **same-origin only** (hover cards, R4/R5) with `credentials: 'include'`.
External media loads happen only for granted hosts. No other network use is permitted (Principle
IV).

All REScue requests go through `src/core/net.ts`, which rejects any URL that is neither same-origin
nor a granted media host. Lint bans direct `fetch` or `XMLHttpRequest` anywhere else (SC-006).
