/** The "Sync across browsers" panel on the console's Sync page (messages mocked). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CloudSyncPanel } from '../../src/ui/settings-console/CloudSync';

let host: HTMLElement;
const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount(reply: (msg: { type: string }) => unknown) {
  const send = vi
    .spyOn(fakeBrowser.runtime, 'sendMessage')
    .mockImplementation((async (msg: { type: string }) => reply(msg)) as never);
  host = document.createElement('div');
  document.body.appendChild(host);
  render(h(CloudSyncPanel, { onSettingsReplaced: () => {} }), host);
  await flush();
  await flush();
  return send;
}

afterEach(() => {
  render(null, host);
  host.remove();
  vi.restoreAllMocks();
});

describe('cloud sync panel', () => {
  it('offers only configured providers, as words with hover text', async () => {
    const send = await mount(() => ({
      ok: true,
      available: [{ id: 'dropbox', label: 'Dropbox' }],
      status: 'off',
      includeTags: true,
    }));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('[data-cloud-connect]')];
    expect(buttons.map((b) => b.textContent)).toEqual(['Dropbox']);
    expect(buttons[0]!.title).toMatch(/^REScue: /);
    expect(host.textContent).toMatch(/never sees it/);
    buttons[0]!.click();
    await flush();
    expect(send).toHaveBeenCalledWith({ type: 'cloudSync.openConnect', provider: 'dropbox' });
  });

  it('says so when no provider is set up in this build', async () => {
    await mount(() => ({ ok: true, available: [], status: 'off', includeTags: true }));
    expect(host.querySelector('[data-cloud-unavailable]')).not.toBeNull();
  });

  it('when connected: last synced, sync now, disconnect (file stays), restore previous', async () => {
    const send = await mount(() => ({
      ok: true,
      available: [],
      provider: 'onedrive',
      label: 'OneDrive',
      status: 'ok',
      lastSyncedAt: Date.UTC(2026, 10, 3),
      includeTags: true,
      previousAt: Date.UTC(2026, 10, 2),
    }));
    expect(host.textContent).toMatch(/Connected to OneDrive\. Last synced/);
    expect(host.textContent).toMatch(/The file stays in your\s+storage/);
    for (const sel of ['[data-cloud-sync-now]', '[data-cloud-disconnect]', '[data-cloud-restore]'])
      expect(host.querySelector<HTMLButtonElement>(sel)?.title).toMatch(/^REScue: /);
    host.querySelector<HTMLButtonElement>('[data-cloud-disconnect]')!.click();
    await flush();
    expect(send).toHaveBeenCalledWith({ type: 'cloudSync.disconnect' });
  });

  it('shows "reconnect" instead of "sync now" when the provider asks for it', async () => {
    await mount(() => ({
      ok: true,
      available: [],
      provider: 'google',
      label: 'Google Drive',
      status: 'reconnect',
      error: 'Your storage provider asks you to connect again.',
      includeTags: false,
    }));
    expect(host.querySelector('[data-cloud-reconnect]')).not.toBeNull();
    expect(host.querySelector('[data-cloud-sync-now]')).toBeNull();
    expect(host.textContent).toMatch(/connect again/);
  });
});
