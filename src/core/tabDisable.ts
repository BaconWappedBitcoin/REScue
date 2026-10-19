/**
 * "Disable REScue in this tab" (RES troubleshooter disableRES): a flag in this tab's session
 * storage that makes the content script stop before it touches the page, so Reddit runs exactly as
 * it would without REScue. It lasts as long as the tab (it survives reloads); other tabs and the
 * saved settings are not affected. A small notice with a "turn REScue back on" word is the only
 * thing REScue shows in a tab where it is off.
 */
const KEY = 'rescue:tabDisabled';

export function isTabDisabled(storage: Storage | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function disableForTab(storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, '1');
  } catch {
    /* storage blocked: nothing to remember */
  }
}

export function enableForTab(storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export const DISABLED_NOTICE_ID = 'rescue-tab-disabled';

/** The "REScue is off in this tab" note, with a button that turns it back on and reloads. */
export function showDisabledNotice(doc: Document = document): void {
  const build = (): void => {
    if (doc.getElementById(DISABLED_NOTICE_ID)) return;
    const host = doc.createElement('div');
    host.id = DISABLED_NOTICE_ID;
    const root = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent =
      ':host{all:initial;position:fixed;right:12px;bottom:12px;z-index:2147483646;font:13px/1.4 system-ui,sans-serif;' +
      'background:#fff;color:#1a1a1b;border:1px solid #ccc;border-left:4px solid #c90;border-radius:4px;padding:6px 10px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.2)}button{font:inherit;margin-left:8px;cursor:pointer}';
    const text = doc.createTextNode('REScue is off in this tab.');
    const on = doc.createElement('button');
    on.type = 'button';
    on.textContent = 'Turn REScue back on';
    on.title = 'REScue: turn REScue back on in this tab and reload the page';
    on.addEventListener('click', () => {
      enableForTab();
      location.reload();
    });
    root.append(style, text, on);
    (doc.body ?? doc.documentElement).appendChild(host);
  };
  if (doc.body) build();
  else doc.addEventListener('DOMContentLoaded', build, { once: true });
}
