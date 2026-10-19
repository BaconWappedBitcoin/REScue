import { describe, expect, it } from 'vitest';
import { isLowEffort } from '../../src/modules/listings/filteReddit/lowEffort';

describe('low-effort replies', () => {
  it.each([
    'This!',
    'this',
    'THIS.',
    'Thisss',
    'This 100%',
    '100%',
    '1000% this',
    'I agree',
    'Agreed.',
    'I totally agree',
    'Exactly',
    'Exactly this.',
    'So much this',
    'This so much!!',
    'Same',
    'Same here',
    'Me too',
    'So true',
    'Facts',
    'Real',
    '+1',
    '^',
    '^^^ this',
    '💯',
    '👆',
    'This is the way',
    'Came here to say this',
    'Underrated comment',
    'Well said',
    'Yep',
    'Yup!',
    'hahaha true',
    'lol same',
    'this right here',
    'What he said',
    'Thank you, this',
    'Bingo',
  ])('catches %j', (s) => expect(isLowEffort(s)).toBe(true));

  it.each([
    '',
    '   ',
    'Is this true?',
    'Exactly? I am not sure',
    'This is a bad idea and here is why',
    'I agree, but the second point is wrong',
    'Same thing happened to me last week at work',
    'The',
    'ok',
    'nice',
    'It is what it is',
    'I agree with you about the budget part',
  ])('leaves %j alone', (s) => expect(isLowEffort(s)).toBe(false));
});

describe('low-effort as a comment filter rule', () => {
  it('matches through the comment rules and describes itself', async () => {
    const { compileCommentRules, matchComment, describeCommentRule } =
      await import('../../src/modules/listings/filteReddit/commentRules');
    const { rules, errors } = compileCommentRules([
      { type: 'low-effort', pattern: '', action: 'collapse', enabled: true },
    ]);
    expect(errors).toEqual([]);
    const facts = (body: string) => ({
      author: 'a',
      depth: 1,
      score: 1,
      body,
      isOp: false,
      distinguished: null,
      created: null,
    });
    const hit = matchComment(facts('So much this!') as never, rules);
    expect(hit && describeCommentRule(hit)).toBe('low-effort reply');
    expect(
      matchComment(facts('A real answer with several words in it.') as never, rules),
    ).toBeNull();
  });
});
