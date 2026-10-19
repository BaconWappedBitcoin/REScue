/** Backup and restore (RES backupAndRestore): local file export/import; optional browser sync. */
import { defineModule, type ModuleContext } from '../../core/types';

const stamp = (d = new Date()) => d.toISOString().slice(0, 10).replace(/-/g, '');

function download(name: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

let stop: (() => void) | null = null;

/**
 * Settings that changed on another device (settings sync) wait in the background until you answer:
 * use them here, or keep this device's. Only a visible tab asks, so several tabs do not each ask.
 */
async function askAboutSyncedSettings(ctx: ModuleContext): Promise<void> {
  if (document.visibilityState !== 'visible') return;
  const status = (await browser.runtime.sendMessage({ type: 'sync.status' }).catch(() => null)) as {
    pending?: boolean;
  } | null;
  if (!status?.pending) return;
  const answer = (type: 'sync.apply' | 'sync.keep', done: string) => () =>
    void browser.runtime
      .sendMessage({ type })
      .then(() => ctx.notices.show(done, { timeoutMs: 5000 }));
  ctx.notices.show('Your REScue settings changed on another device.', {
    id: 'sync-pending',
    moduleId: 'backupAndRestore',
    timeoutMs: 0,
    actions: [
      {
        label: 'Use them here',
        hint: 'REScue: replace the settings on this device with the ones from your other device',
        run: answer('sync.apply', 'REScue: the synced settings are now in use.'),
      },
      {
        label: 'Keep mine',
        hint: 'REScue: keep this device’s settings; the other device’s change is not used',
        run: answer('sync.keep', 'REScue: kept this device’s settings.'),
      },
    ],
  });
}

export const backupRestore = defineModule({
  id: 'backupAndRestore',
  resId: 'backupAndRestore',
  category: 'core',
  title: 'Backup & restore',
  description:
    'Export your settings, user tags, filters and saved comments to a file, or import one. Nothing is uploaded anywhere. Settings sync is in Core › Sync.',
  enabledByDefault: true,
  options: {
    includeRead: {
      type: 'boolean',
      default: false,
      title: 'Include read history in exports',
      description: 'Read history can be large.',
    },
    importMode: {
      type: 'enum',
      default: 'merge',
      title: 'When importing',
      values: [
        { value: 'merge', label: 'Merge with what is here' },
        { value: 'replace', label: 'Replace everything' },
      ],
    },
    warnBeforeAutomaticRestore: {
      type: 'boolean',
      default: true,
      title: 'Ask before using settings that changed on another device',
      description:
        'With settings sync on (Settings console, bottom), a change made on another device waits for your answer before it replaces the settings here. Off: it is applied at once.',
    },
  },

  init(ctx) {
    void askAboutSyncedSettings(ctx);
    const listener = (msg: unknown): undefined => {
      if ((msg as { type?: string } | null)?.type === 'sync.pending')
        void askAboutSyncedSettings(ctx);
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    stop = () => browser.runtime.onMessage.removeListener(listener);
  },

  dispose() {
    stop?.();
    stop = null;
  },
  actions: [
    {
      id: 'export',
      label: 'Export backup file',
      async run(ctx) {
        const res = (await browser.runtime.sendMessage({
          type: 'backup.export',
          includeRead: ctx.options.includeRead,
        })) as { ok: boolean; file?: unknown };
        if (!res?.ok || !res.file)
          return ctx.notices.show('REScue: the backup could not be created.', { kind: 'error' });
        download(`rescue-backup-${stamp()}.json`, JSON.stringify(res.file, null, 2));
      },
    },
    {
      id: 'import',
      label: 'Import backup file',
      kind: 'file',
      confirm:
        'Import this backup? With "Replace everything" your current REScue data is overwritten.',
      async run(ctx, file) {
        if (!file) return;
        const json = await file.text();
        const res = (await browser.runtime.sendMessage({
          type: 'backup.import',
          json,
          mode: ctx.options.importMode,
        })) as { ok: boolean; error?: string };
        ctx.notices.show(
          res?.ok
            ? 'REScue: backup imported. Reload Reddit tabs to apply it.'
            : `REScue: import failed. ${res?.error ?? ''}`,
          {
            kind: res?.ok ? 'info' : 'error',
          },
        );
      },
    },
  ],
});
