/**
 * The page that connects cloud sync to one storage provider. It is an extension page because only
 * extension pages may call `permissions.request` (and only from a click), and a content script on
 * Reddit can use neither that nor `identity`. Opened by the background from the settings console.
 * Steps: (1) ask for the provider's API hosts (and, in Chrome, the optional `identity`
 * permission); (2) the background prepares the authorization (state + PKCE) and this page shows
 * the provider's sign-in with identity.launchWebAuthFlow; (3) the background checks the answer,
 * redeems it and keeps the tokens. This page only relays the provider's answer (for Google that
 * answer carries the short-lived access token itself) and keeps nothing.
 */
import { browser } from 'wxt/browser';
import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDER_ORIGINS } from '../../contracts/cloud';
import { hint } from '../../core/hints';
import { isProviderId } from '../../core/cloudSync/types';

const allow = document.getElementById('allow') as HTMLButtonElement;
const cancel = document.getElementById('cancel') as HTMLButtonElement;
const result = document.getElementById('result') as HTMLElement;
const providerName = document.getElementById('provider') as HTMLElement;
const hostsText = document.getElementById('hosts') as HTMLElement;

const raw = new URLSearchParams(location.search).get('provider');
const provider = isProviderId(raw) ? raw : null;

allow.title = hint.cloudConnectContinue;
cancel.title = hint.cloudConnectCancel;

if (!provider) {
  allow.disabled = true;
  result.textContent = 'Unknown storage provider.';
} else {
  const label = CLOUD_PROVIDER_LABELS[provider];
  document.title = `REScue: connect ${label}`;
  providerName.textContent = label;
  hostsText.textContent = CLOUD_PROVIDER_ORIGINS[provider]
    .map((o) => new URL(o.replace('/*', '/')).hostname)
    .join(' and ');
}

interface Reply {
  ok: boolean;
  url?: string;
  error?: string;
  status?: string;
}

async function connect(granted: boolean): Promise<void> {
  if (!provider) return;
  if (!granted) {
    result.textContent = 'Permission was not given, so nothing was connected.';
    return;
  }
  result.textContent = 'Opening the sign-in window…';
  const begin = (await browser.runtime.sendMessage({
    type: 'cloudSync.beginAuth',
    provider,
  })) as Reply;
  if (!begin?.ok || !begin.url) throw new Error(begin?.error ?? 'REScue could not start sign-in.');
  const identity = (
    browser as unknown as {
      identity?: { launchWebAuthFlow(d: { url: string; interactive: boolean }): Promise<string> };
    }
  ).identity;
  if (!identity) throw new Error('The browser did not give REScue the identity permission.');
  const responseUrl = await identity.launchWebAuthFlow({ url: begin.url, interactive: true });
  result.textContent = 'Connecting…';
  const done = (await browser.runtime.sendMessage({
    type: 'cloudSync.finishAuth',
    responseUrl,
  })) as Reply;
  if (!done?.ok) throw new Error(done?.error ?? 'REScue could not connect.');
  result.textContent =
    done.status === 'ok'
      ? `Connected to ${CLOUD_PROVIDER_LABELS[provider]}. Your settings are synced.`
      : `Connected to ${CLOUD_PROVIDER_LABELS[provider]}, but the first sync did not finish; see REScue settings, under Sync.`;
  setTimeout(() => window.close(), 2500);
}

allow.addEventListener('click', () => {
  if (!provider) return;
  allow.disabled = true;
  // Called straight from the click: the browser requires a user gesture here. Firefox holds
  // `identity` as a required permission (it cannot be optional there); Chrome asks for it now.
  browser.permissions
    .request({
      origins: [...CLOUD_PROVIDER_ORIGINS[provider]],
      ...(import.meta.env.FIREFOX ? {} : { permissions: ['identity'] }),
    })
    .then(connect)
    .catch((err: unknown) => {
      result.textContent = `Not connected: ${err instanceof Error ? err.message : String(err)}`;
    })
    .finally(() => {
      allow.disabled = false;
    });
});

cancel.addEventListener('click', () => window.close());
