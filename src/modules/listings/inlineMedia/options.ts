/** The inlineMedia option schema, kept out of index.ts so that stays small. */
import type { OptionSchema } from '../../../core/types';
import { EXTRA_OPTIONS } from './extraOptions';
import { SUB_ACTIONS, validateSubRow } from './policy';

export const OPTIONS = {
  ...EXTRA_OPTIONS,
  collapseMedia: {
    type: 'boolean',
    default: false,
    title: 'Hide inline media',
    description:
      'Hide the pictures, GIFs and videos inside comments, each behind a word in its place (“show image”, “show GIF”, “show video”). Also the switch in the REScue menu. Posts are not touched unless you also switch on the option below.',
  },
  collapsePostMedia: {
    type: 'boolean',
    default: false,
    title: 'Also hide the post’s own picture or video',
    description:
      'Also hide the media of the post itself (its picture, gallery, video or embed), behind a word after its time. The three choices below say where and which ones.',
    dependsOn: 'collapseMedia',
  },
  scope: {
    type: 'enum',
    default: 'listings',
    title: 'Where to hide post media',
    description: 'For the post’s own media. Media in comments is hidden wherever comments show.',
    values: [
      { value: 'listings', label: 'In listings (front page, subreddits, search, profiles)' },
      { value: 'both', label: 'In listings and on thread pages' },
      { value: 'threads', label: 'On thread pages only' },
    ],
  },
  onlyTypes: {
    type: 'enum',
    default: 'all',
    title: 'What post media to hide',
    description: 'For the post’s own media.',
    values: [
      { value: 'all', label: 'All media' },
      { value: 'sensitive', label: 'Only NSFW and spoiler posts' },
      { value: 'video', label: 'Only video' },
      { value: 'gallery', label: 'Only galleries' },
    ],
  },
  perSubreddit: {
    type: 'table',
    default: [],
    title: 'Subreddits',
    description:
      'Always show or always hide the media of a subreddit: its posts and the comments of its threads. A row here decides for that subreddit whatever the switches and the choices above say; the page scope still applies to posts.',
    columns: [
      { key: 'subreddit', title: 'Subreddit', type: 'text' },
      {
        key: 'action',
        title: 'Media',
        type: 'enum',
        values: SUB_ACTIONS,
        default: 'always collapse',
      },
    ],
    validateRow: validateSubRow,
  },
  rememberExpanded: {
    type: 'boolean',
    default: true,
    title: 'Keep posts I showed open',
    description:
      'A post whose media you showed stays shown when you see it again. Kept on this device only and forgotten after 90 days.',
  },
  blockDownloads: {
    type: 'boolean',
    default: false,
    title: 'Block media downloads',
    description:
      'Hiding media stops video but not pictures from downloading. This also stops your browser from downloading media from Reddit’s media servers (*.redd.it) while a post’s media is hidden, to save data. That includes the media in comments. It needs a permission the browser asks you for, applies to every Reddit tab, and cannot let single posts through: use “Allow in this tab” or turn it off to see media. REScue only blocks; it sends nothing.',
    dependsOn: 'collapsePostMedia',
  },
} as const satisfies OptionSchema;
