/**
 * "Sync across browsers" on the console's Sync page: connect one cloud storage provider (the
 * user's own Google Drive, Dropbox or OneDrive), see when it last synced, sync now, disconnect,
 * and undo the last cloud copy. The work happens in the background (src/core/cloudSync/); this
 * component only sends messages and shows the answers. It never sees a token.
 */
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { hint } from '../../core/hints';
import type { CloudSyncStatus } from '../../core/cloudSync/service';

export const CLOUD_TITLE = 'Sync across browsers';
export const CLOUD_TEXT =
  'Keep the same settings in every browser and on every computer: REScue saves them as one small file in your own Google Drive, Dropbox or OneDrive.';

type Reply = CloudSyncStatus | { ok: false; error?: string } | null | undefined;

const ask = (msg: object): Promise<Reply> =>
  (browser.runtime.sendMessage(msg) as Promise<Reply>).catch(() => null);

const when = (ms: number): string => new Date(ms).toLocaleString();

export function CloudSyncPanel({ onSettingsReplaced }: { onSettingsReplaced(): void }) {
  const [st, setSt] = useState<CloudSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const take = (r: Reply): void => {
    if (r && r.ok) setSt(r);
    else setNote(r?.error ?? 'REScue could not reach its background page.');
  };

  useEffect(() => {
    const refresh = () => void ask({ type: 'cloudSync.status' }).then((r) => r?.ok && setSt(r));
    refresh();
    // Back from the connect window: show what it did.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const run = async (msg: object, after?: () => void): Promise<void> => {
    setBusy(true);
    setNote('');
    try {
      take(await ask(msg));
      after?.();
    } finally {
      setBusy(false);
    }
  };

  const connect = (id: string): void => {
    setNote('');
    void ask({ type: 'cloudSync.openConnect', provider: id }).then((r) => {
      if (r && !r.ok) setNote(r.error ?? 'Could not open the connect window.');
      else setNote('Finish connecting in the window that opened, then come back here.');
    });
  };

  if (!st) return null;
  const connected = !!st.provider;
  const label = st.label ?? '';

  return (
    <div class="cloud-sync" data-cloud-sync="">
      <h3>{CLOUD_TITLE}</h3>
      <p class="desc">{CLOUD_TEXT}</p>
      <p class="desc">
        The file goes only to the storage provider you connect, into a folder only REScue can use.
        REScue has no server and never sees it. Your sign-in stays on this browser. Read history,
        saved comments and hidden posts are never sent. If this and the browser sync above are both
        on, the cloud copy decides your settings.
      </p>
      {!connected ? (
        st.available.length ? (
          <div class="actions">
            {st.available.map((p) => (
              <button
                type="button"
                key={p.id}
                data-cloud-connect={p.id}
                title={hint.cloudConnect(p.label)}
                onClick={() => connect(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <p class="hint" data-cloud-unavailable="">
            Not available in this version of REScue yet.
          </p>
        )
      ) : (
        <>
          <p data-cloud-state={st.status}>
            Connected to <b>{label}</b>.{' '}
            {st.lastSyncedAt ? `Last synced ${when(st.lastSyncedAt)}.` : 'Not synced yet.'}
          </p>
          {st.error ? <p class="hint cloud-error">{st.error}</p> : null}
          <label>
            <input
              type="checkbox"
              data-cloud-tags=""
              checked={st.includeTags}
              disabled={busy}
              title={hint.cloudTags(st.includeTags)}
              onChange={(e) =>
                void run({
                  type: 'cloudSync.setTags',
                  on: (e.currentTarget as HTMLInputElement).checked,
                })
              }
            />{' '}
            Also sync user tags
          </label>
          <div class="actions">
            {st.status === 'reconnect' && st.provider ? (
              <button
                type="button"
                data-cloud-reconnect=""
                title={hint.cloudReconnect(label)}
                onClick={() => connect(st.provider!)}
              >
                reconnect
              </button>
            ) : (
              <button
                type="button"
                data-cloud-sync-now=""
                disabled={busy}
                title={hint.cloudSyncNow}
                onClick={() => void run({ type: 'cloudSync.syncNow' }, onSettingsReplaced)}
              >
                sync now
              </button>
            )}
            <button
              type="button"
              data-cloud-disconnect=""
              disabled={busy}
              title={hint.cloudDisconnect}
              onClick={() => void run({ type: 'cloudSync.disconnect' })}
            >
              disconnect
            </button>
            {st.previousAt ? (
              <button
                type="button"
                data-cloud-restore=""
                disabled={busy}
                title={hint.cloudRestore}
                onClick={() => void run({ type: 'cloudSync.restorePrevious' }, onSettingsReplaced)}
              >
                restore previous
              </button>
            ) : null}
          </div>
          <p class="hint">
            Disconnecting forgets the sign-in on this browser only. The file stays in your storage;
            delete it there if you want it gone.
            {st.previousAt
              ? ` "Restore previous" puts back the settings this browser had on ${when(st.previousAt)}, before the last cloud copy replaced them.`
              : ''}
          </p>
        </>
      )}
      {note ? (
        <p class="hint" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
