/**
 * Low-effort replies: comments that only agree ("This!", "100%", "I agree", "Exactly", "So much
 * this", "+1", "^"). A comment counts when its text is at most six words and every word is an
 * agreement or filler word, or when it is nothing but a pointer or agreement symbol. A question
 * never counts, and neither does a comment with no text (a picture or a GIF).
 */
const WORDS = new Set(
  (
    'this that these so much very totally completely absolutely fully really honestly literally ' +
    'just right here there too me i im agree agreed agreeing exactly precisely same true facts ' +
    'fact real based ditto bingo preach word correct indeed yes yep yup yeah yea ya yas +1 100 ' +
    '100% 1000% 110% lol lmao lmfao rofl ok okay nice well said nailed it underrated comment ' +
    'came to say is the way a an and all of what he she they you u said thread thank thanks ' +
    'up upvote upvoted top'
  ).split(' '),
);
/** Words that mean agreement: a comment needs at least one, so "the it a" is not caught. */
const CORE = new Set(
  (
    'this agree agreed agreeing exactly precisely same true facts fact real based ditto bingo ' +
    'preach word correct indeed yes yep yup yeah yea yas +1 100 100% 1000% 110% lol lmao lmfao ' +
    'rofl nailed underrated upvote upvoted way too said'
  ).split(' '),
);
const SYMBOLS = /^(?:\s|\^|👆|☝️?|💯|👍|🙌|👏|🔥)+$/u;
const MAX_WORDS = 6;

/** Lower case, letters squeezed ("thisss" -> "this", "yesss" -> "yes"), punctuation dropped. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/([a-z])\1{2,}/g, '$1')
    .replace(/(ha){2,}h?/g, 'lol')
    .replace(/[^a-z0-9%+\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function isLowEffort(body: string): boolean {
  const text = body.trim();
  if (!text || text.includes('?')) return false;
  if (SYMBOLS.test(text)) return /[^\s]/.test(text);
  const w = words(text);
  if (!w.length || w.length > MAX_WORDS) return false;
  return w.every((x) => WORDS.has(x)) && w.some((x) => CORE.has(x));
}
