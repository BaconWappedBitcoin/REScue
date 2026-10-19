/**
 * The "Show advanced options" checkbox is a per-device console preference, remembered in its own
 * storage key (not in the settings profile, so it is not synced or exported).
 */
const KEY = 'consoleShowAdvanced';

export async function loadShowAdvanced(): Promise<boolean> {
  try {
    const got = await browser.storage.local.get(KEY);
    return got[KEY] === true;
  } catch {
    return false;
  }
}

export function saveShowAdvanced(on: boolean): void {
  try {
    void browser.storage.local.set({ [KEY]: on }).catch(() => undefined);
  } catch {
    // Storage unavailable: the checkbox simply is not remembered.
  }
}
