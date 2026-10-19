/** Styles for the user tagger's inline controls (kept apart so userTagger.ts stays small). */
import { CHIP_CSS } from './tagChip';

export const STYLE_ID = 'rescue-user-tagger-style';
export const STYLE = [
  '.rescue-author-extras{display:inline-flex;gap:4px;align-items:baseline;margin-left:4px;font-size:12px}',
  CHIP_CSS,
].join('\n');
