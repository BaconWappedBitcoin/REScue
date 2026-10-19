/**
 * User tagger option schema, split out so userTagger.ts stays under the 500-line project limit.
 * The schema is imported and re-exported by the module definition in userTagger.ts.
 */
import type { OptionSchema } from '../../core/types';
import { validColor } from './tagStore';

export const taggerOptionsSchema = {
  hideIgnoredPosts: {
    type: 'boolean',
    default: true,
    title: 'Hide posts by ignored users',
    description: 'Hidden posts are counted by the filter notice and can be revealed there.',
  },
  collapseIgnoredComments: {
    type: 'boolean',
    default: true,
    title: 'Collapse comments by ignored users',
    description: 'Only the comment itself is collapsed, with a link to show it; replies stay.',
  },
  ignoreButtonOnComments: {
    type: 'boolean',
    default: true,
    title: 'Show an ignore button on comments',
    description: 'A small ignore/unignore button after every comment author’s name.',
  },
  ignoreButtonOnPosts: {
    type: 'boolean',
    default: true,
    title: 'Show an ignore button on posts',
    description: 'A small ignore/unignore button after every post author’s name in listings.',
  },
  showTaggingIcon: {
    type: 'boolean',
    default: true,
    title: 'Show the tag button',
    description:
      'The small tag button after every name. Off: it only appears next to users you have already tagged.',
  },
  storeSourceLink: {
    type: 'boolean',
    default: true,
    title: 'Pre-fill the link with where you tagged from',
    description:
      'Opening the editor from a post or comment fills the link with that item’s permalink when the user has no link yet.',
    advanced: true,
  },
  trackVoteWeight: {
    type: 'boolean',
    default: true,
    title: 'Count my votes on users',
    description:
      'Shows "+3 −1" (your upvotes and downvotes) after a name. Counts clicks on Reddit’s own arrows on posts and comments, and keyboard votes.',
    advanced: true,
  },
  colorVoteWeight: {
    type: 'boolean',
    default: true,
    title: 'Colour the vote count',
    description: 'Green when you mostly upvote that user, red when you mostly downvote them.',
    advanced: true,
    dependsOn: 'trackVoteWeight',
  },
  truncateTag: {
    type: 'boolean',
    default: true,
    title: 'Shorten long tags',
    description: 'Cut long tags with "…"; the full text shows on hover.',
    advanced: true,
  },
  presetTags: {
    type: 'table',
    default: [],
    title: 'Preset tags',
    description: 'Tags you can apply with one click in the editor. "+ preset" there adds a row.',
    advanced: true,
    columns: [
      { key: 'text', title: 'Tag', type: 'text' },
      { key: 'color', title: 'Colour', type: 'color', default: '#e0e0e0' },
    ],
    validateRow: (row) => {
      const text = typeof row.text === 'string' ? row.text.trim() : '';
      if (text.length > 100) return 'A tag can be at most 100 characters.';
      const color = typeof row.color === 'string' ? row.color : '';
      return color && !validColor(color) ? 'Colour must look like #ff8800.' : null;
    },
  },
} satisfies OptionSchema;
