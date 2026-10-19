/**
 * old.reddit.com -> www.reddit.com (T060). old.reddit now answers most paths with a login wall,
 * which looks like REScue being broken; this takes the reader to the same page on www, where
 * REScue renders it, with a short notice there. Pages that only exist on old.reddit (preferences,
 * inbox, wiki, moderation) are left alone. Off with one switch: oldRedditRedirect.enabled.
 * Approach from Sheddit src/core/oldreddit.js (GPL-3.0, kookaburrabarrel, cff40d7).
 */
const OLD_ONLY =
  /^\/(prefs|message|wiki|r\/[^/]+\/wiki|r\/[^/]+\/about\/(modqueue|reports|spam|edited|unmoderated|log)|login|register)(\/|$)/i;

export default defineContentScript({
  matches: ['*://old.reddit.com/*'],
  runAt: 'document_start',
  async main() {
    if (OLD_ONLY.test(location.pathname)) return;
    const { settings } = await browser.storage.local.get('settings');
    const mods = (settings as { modules?: Record<string, { enabled?: boolean }> } | undefined)
      ?.modules;
    if (mods?.oldRedditRedirect?.enabled === false) return;
    const u = new URL(location.href);
    u.hostname = 'www.reddit.com';
    u.searchParams.set('rescue_from_old', '1');
    location.replace(u.href);
  },
});
