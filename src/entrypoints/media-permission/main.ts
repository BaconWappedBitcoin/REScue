/**
 * The page that asks for the optional media-blocking permission. It is an extension page because
 * only extension pages may call `permissions.request`, and only from a click (a content script on
 * Reddit can do neither). Opened by the background when "Block media downloads" is turned on.
 */
import { browser } from 'wxt/browser';
import { hint } from '../../core/hints';
import { MEDIA_PERMISSIONS } from '../../core/mediaBlock';

const allow = document.getElementById('allow') as HTMLButtonElement;
const cancel = document.getElementById('cancel') as HTMLButtonElement;
const result = document.getElementById('result') as HTMLElement;
allow.title = hint.mediaPermAllow;
cancel.title = hint.mediaPermCancel;

allow.addEventListener('click', () => {
  // Called straight from the click: the browser requires a user gesture here.
  browser.permissions
    .request(MEDIA_PERMISSIONS)
    .then(async (granted) => {
      if (!granted) {
        result.textContent = 'Permission was not given, so downloads are not blocked.';
        return;
      }
      await browser.runtime.sendMessage({ type: 'media.blocking', action: 'status' });
      result.textContent = 'Done. Media downloads are now blocked while media is hidden.';
      setTimeout(() => window.close(), 1200);
    })
    .catch((err: unknown) => {
      result.textContent = `The browser refused the request: ${String(err)}`;
    });
});

cancel.addEventListener('click', () => window.close());
