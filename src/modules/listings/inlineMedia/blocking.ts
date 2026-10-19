/**
 * The content side of opt-in download blocking: asks the background what state it is in, asks it
 * to open the permission window, and asks it to let this tab download media. The permission itself
 * is requested on the extension page the background opens (a content script cannot do it).
 */
import { browser } from 'wxt/browser';
import type { BlockState } from '../../../core/mediaBlock';

export type BlockingAction = 'status' | 'ask' | 'allowTab';

/** The background's answer, or null when it cannot be reached. */
export async function blockingRequest(action: BlockingAction): Promise<BlockState | null> {
  try {
    const r = (await browser.runtime.sendMessage({ type: 'media.blocking', action })) as
      { ok?: boolean; state?: BlockState } | undefined;
    return r?.ok ? (r.state ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Open the permission window only when blocking has just been turned on (never on every settings
 * change); the background opens it only if the permission is actually missing.
 */
export function shouldAsk(wasWanted: boolean, wanted: boolean): boolean {
  return wanted && !wasWanted;
}
