/**
 * Startup check: LibreWolf sometimes loads a Reddit page without running REScue's content scripts
 * (seen when a thread is opened directly; a refresh fixed it). After each Reddit page finishes
 * loading, the background asks the tab whether REScue answered; if nothing does, it starts the
 * bridge and the content script itself. The instance guard and the bridge's own flag keep a
 * second start from doubling anything.
 */
export const PING = 'rescue.ping';

const REDDIT_PAGE = /^https?:\/\/(?:www\.|sh\.)?reddit\.com\/(?!media)/i;

export function isRedditPage(url: string | undefined): boolean {
  return !!url && REDDIT_PAGE.test(url);
}

export interface StartupApi {
  ping(tabId: number): Promise<unknown>;
  inject(tabId: number): Promise<void>;
}

/** True when REScue had to be started in the tab. */
export async function ensureRunning(tabId: number, api: StartupApi): Promise<boolean> {
  const answer = await api.ping(tabId).catch(() => undefined);
  if (answer === true) return false;
  await api.inject(tabId).catch(() => {});
  return true;
}
