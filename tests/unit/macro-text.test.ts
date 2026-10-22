import { describe, expect, it } from 'vitest';
import { escapeMarkdown, expandMacro } from '../../src/model/macroText';

const now = new Date(2026, 9, 21, 14, 5, 0);
const vars = {
  author: 'someone',
  subreddit: 'Layoffs',
  myUsername: 'me',
  url: 'https://www.reddit.com/r/Layoffs/comments/x/y/',
  selected: 'a *quoted* line',
  now,
};

describe('macro placeholders', () => {
  it('fills in every RES placeholder', () => {
    expect(expandMacro('Hi u/{{author}}, from u/{{my_username}} in r/{{subreddit}}', vars)).toBe(
      'Hi u/someone, from u/me in r/Layoffs',
    );
    expect(expandMacro('{{url}}', vars)).toBe(vars.url);
    expect(expandMacro('> {{selected}} / {{selection}}', vars)).toBe(
      '> a *quoted* line / a *quoted* line',
    );
    expect(expandMacro('{{escaped}}', vars)).toBe('a \\*quoted\\* line');
    expect(expandMacro('{{now}}', vars)).toBe(now.toLocaleString());
    expect(expandMacro('{{today}}', vars)).toBe(now.toLocaleDateString());
  });

  it('accepts spaces inside the braces and any letter case', () => {
    expect(expandMacro('{{ Author }}', vars)).toBe('someone');
  });

  it('leaves unknown placeholders exactly as typed, including object-prototype names', () => {
    expect(expandMacro('{{nope}} {{constructor}} {{__proto__}} {{toString}}', vars)).toBe(
      '{{nope}} {{constructor}} {{__proto__}} {{toString}}',
    );
  });

  it('turns a known placeholder with no value into nothing', () => {
    expect(expandMacro('[{{author}}][{{selected}}]', {})).toBe('[][]');
  });

  it('does not re-expand placeholders found inside a value', () => {
    expect(expandMacro('{{selected}}', { selected: '{{author}}', author: 'x' })).toBe('{{author}}');
  });

  it('escapes every Markdown symbol', () => {
    expect(escapeMarkdown('*_`~^>#[]()\\|')).toBe('\\*\\_\\`\\~\\^\\>\\#\\[\\]\\(\\)\\\\\\|');
    expect(escapeMarkdown('plain words')).toBe('plain words');
  });
});
