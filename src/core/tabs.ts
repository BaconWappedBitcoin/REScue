/** Opening links: in this tab, or in new tabs through the background (window.open is blocked). */

/** An absolute http(s) URL for `href`, or null (relative links resolve against the page). */
export function webUrl(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const u = new URL(href, location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Open up to two URLs in new tabs; the first one is focused when `active`. */
export function openTabs(urls: string[], active: boolean): void {
  const safe = urls.map(webUrl).filter((u): u is string => !!u);
  if (!safe.length) return;
  void browser.runtime.sendMessage({ type: 'tabs.open', urls: safe, active }).catch(() => {
    for (const u of safe) window.open(u, '_blank', 'noopener');
  });
}
