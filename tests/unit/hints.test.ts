import { describe, expect, it } from 'vitest';
import { hint, IGNORED_USER, label, parentArrowText, plain } from '../../src/core/hints';
import { setChip } from '../../src/modules/listings/filteReddit/ui';

describe('hover hints', () => {
  it('every fixed text starts with "REScue: " and stays short', () => {
    for (const [name, value] of Object.entries(hint)) {
      if (typeof value !== 'string') continue;
      expect(value, name).toMatch(/^REScue: \S/);
      expect(value.length, name).toBeLessThanOrEqual(120);
    }
  });

  it('every text built from a name or count keeps the prefix and the length', () => {
    const built = [
      hint.gear('settings'),
      hint.menuHideNsfw(true),
      hint.menuCustomToggle('Work mode', false),
      hint.savedOpener(4),
      hint.navPosition('3/12'),
      hint.filterMenuItem('domain', 'example.com'),
      hint.filterReason('Collapsed', 'keyword: laid'),
      hint.upvoteRatio('97% upvoted'),
      hint.scoreChip('comment', 12345),
      hint.newCount(5),
      hint.tagChip('friend', 'someone'),
      hint.votePill('someone', '+3 −1'),
      hint.shortcutToggle('aww', true),
      hint.linkNumber('3', 'alt'),
      hint.managerDelete('someone', true),
      hint.rowDrag(2),
    ];
    for (const text of built) {
      expect(text).toMatch(/^REScue: \S/);
      expect(text.length).toBeLessThanOrEqual(120);
    }
  });

  it('toggles describe what a click does in their current state', () => {
    expect(hint.hideAllReplies(false)).not.toBe(hint.hideAllReplies(true));
    expect(hint.hideChildren(false, 4)).toMatch(/hide the replies/);
    expect(hint.hideChildren(true, 4)).toMatch(/show the 4 hidden replies/);
    expect(hint.hideChildren(true, 1)).toMatch(/1 hidden reply/);
    expect(hint.filterReveal(false)).toMatch(/show/);
    expect(hint.filterReveal(true)).toMatch(/hide/);
    expect(hint.filterPower(true)).toMatch(/pause/);
    expect(hint.filterPower(false)).toMatch(/turn them back on/);
    expect(hint.filterSubToggle('aww', false)).toMatch(/hide posts from r\/aww/);
    expect(hint.filterSubToggle('aww', true)).toMatch(/stop hiding r\/aww/);
    expect(hint.saveComment(false)).not.toBe(hint.saveComment(true));
    expect(hint.ignoreToggle(false)).toMatch(/show/);
    expect(hint.ignoreToggle(true)).toMatch(/collapse/);
    expect(hint.menuHideNsfw(false)).toMatch(/hide them/);
    expect(hint.menuHideNsfw(true)).toMatch(/show them/);
    expect(hint.autoHideToggle(false)).not.toBe(hint.autoHideToggle(true));
    expect(hint.filterPlaceholderButton(false)).toMatch(/show/);
    expect(hint.filterPlaceholderButton(true)).toMatch(/hide/);
    expect(hint.shortcutToggle('aww', false)).toMatch(/add r\/aww/);
    expect(hint.shortcutToggle('aww', true)).toMatch(/remove r\/aww/);
    expect(hint.managerDelete('x', false)).not.toBe(hint.managerDelete('x', true));
  });

  it('counts and positions read correctly', () => {
    expect(hint.newCount(1)).toMatch(/^REScue: 1 comment posted/);
    expect(hint.newCount(3)).toMatch(/^REScue: 3 comments posted/);
    expect(hint.navPosition('3/12')).toMatch(/match 3 of 12/);
    expect(hint.navPosition('~3/12')).toMatch(/moved off/);
    expect(hint.navPosition('0/12')).toMatch(/none reached yet/);
    expect(hint.navPosition('none')).toMatch(/no comment matches/);
    expect(hint.savedOpener(0)).toMatch(/empty/);
    expect(hint.savedOpener(2)).toMatch(/2 comments/);
    expect(hint.linkNumber('3')).toBe('REScue: press 3 to open this link');
    expect(hint.linkNumber('3', 'alt')).toMatch(/Alt\+3/);
  });

  it('plain() drops the prefix for aria-labels', () => {
    expect(plain(hint.backToTop)).toBe('scroll back to the top of the page');
    expect(plain('no prefix')).toBe('no prefix');
  });

  it('visible labels are words, not symbols', () => {
    for (const [name, text] of Object.entries(label)) {
      expect(text, name).toMatch(/[A-Za-z]{2}/);
      expect(text, name).toBe(text.trim());
    }
  });
});

describe('wording that depends on direction or cause', () => {
  it('the show-parent line reads correctly whichever way the popup opens', () => {
    // Opened below: nearest parent first, so the entry above replies to the one below it.
    expect(parentArrowText('down')).toBe('the comment above replies to the one below ↓');
    // Opened above: topmost first, so the entry below replies to the one above it.
    expect(parentArrowText('up')).toBe('↑ the comment below replies to the one above');
  });

  it('a reason chip says “Ignored user” for ignored users and “Filtered:” for rules', () => {
    const chip = document.createElement('span');
    setChip(chip, IGNORED_USER);
    expect(chip.textContent).toBe('Ignored user');
    expect(chip.title).toMatch(/^REScue: you ignore this user/);
    setChip(chip, 'keyword: laid');
    expect(chip.textContent).toBe('Filtered: keyword: laid');
    setChip(chip, 'keyword: laid', 'Collapsed');
    expect(chip.textContent).toBe('Collapsed: keyword: laid');
  });
});
