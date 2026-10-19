/**
 * inlineMedia options that belong to the post's “show / hide” word rather than to the policy of
 * what starts hidden: RES showImages mediaBrowse, scrollOnExpando, highlightNSFWButton and
 * highlightSpoilerButton. Kept here so index.ts stays small.
 */
import type { OptionSchema } from '../../../core/types';

export const EXTRA_OPTIONS = {
  mediaBrowse: {
    type: 'boolean',
    default: true,
    title: 'Move the shown media along with j / k',
    description:
      'When you showed a post’s media and then move to another post with the keyboard, hide that post’s media again and show the next post’s. Only for posts whose media you showed yourself.',
    dependsOn: 'collapsePostMedia',
  },
  scrollOnExpando: {
    type: 'boolean',
    default: true,
    title: 'Scroll shown media into view',
    description: 'After you show a post’s media, scroll the page so the whole post is on screen.',
    dependsOn: 'collapsePostMedia',
  },
  highlightNSFWButton: {
    type: 'boolean',
    default: true,
    title: 'Highlight the word on NSFW posts',
    description: 'Show the “show image” word of an NSFW post in red.',
  },
  highlightSpoilerButton: {
    type: 'boolean',
    default: true,
    title: 'Highlight the word on spoiler posts',
    description: 'Show the “show image” word of a spoiler post in bold dark grey.',
  },
} as const satisfies OptionSchema;
