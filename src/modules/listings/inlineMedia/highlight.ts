/**
 * Colours for the “show image” word of NSFW and spoiler posts (RES showImages
 * highlightNSFWButton / highlightSpoilerButton). The word is REScue's own button; it carries
 * data-rescue-sensitive and these rules, which win over its inline style, colour it.
 */
export const SENSITIVE_ATTR = 'data-rescue-sensitive';

export function highlightCss(nsfw: boolean, spoiler: boolean): string {
  const rules: string[] = [];
  if (nsfw)
    rules.push(
      `.rescue-media-toggle[${SENSITIVE_ATTR}="nsfw"] { color: var(--rescue-nsfw, #d93a00) !important; font-weight: 600 !important; }`,
    );
  if (spoiler)
    rules.push(
      `.rescue-media-toggle[${SENSITIVE_ATTR}="spoiler"] { color: var(--rescue-fg, #1a1a1b) !important; font-weight: 700 !important; }`,
    );
  return rules.join('\n');
}

/** Which highlight a post gets, or '' for none. NSFW wins over spoiler. */
export function sensitiveOf(post: { nsfw: boolean; spoiler: boolean }): 'nsfw' | 'spoiler' | '' {
  return post.nsfw ? 'nsfw' : post.spoiler ? 'spoiler' : '';
}
