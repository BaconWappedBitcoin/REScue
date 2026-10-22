import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOptions } from '../../src/core/settings';
import type { ItemBatch, ModuleContext, ModuleUi, OptionValue } from '../../src/core/types';
import { Decorations } from '../../src/layout/decorations';
import { NativeAdapter } from '../../src/layout/native/adapter';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import {
  COLOR_PRESETS,
  presetByName,
  presetForHex,
  presetRow,
  presetTagsFrom,
  tagTextColor,
} from '../../src/modules/users/tagColors';
import {
  closeTagEditor,
  openTagEditor,
  type EditorRequest,
} from '../../src/modules/users/tagEditor';
import {
  closeTagManager,
  listTags,
  openTagManager,
  refreshTagManager,
  type ManagerHost,
} from '../../src/modules/users/tagManager';
import {
  adjustTally,
  adjustVotes,
  contrastRatio,
  formatVotes,
  pillTextColor,
  sanitizeTags,
  setTally,
  setVotes,
  voteWeightColor,
  type UserTag,
  type UserTags,
} from '../../src/modules/users/tagStore';
import { userTagger, recordVotes } from '../../src/modules/users/userTagger';
import { attachVoteCounter, voteDeltas } from '../../src/modules/users/voteCounter';
import { listingHtml, mount, nestedThreadHtml } from '../fixtures/pages';

const NOW = 1_700_000_000_000;
/** happy-dom keeps a style colour as typed; Chrome turns #rrggbb into rgb(). Compare as rgb(). */
const rgb = (c: string): string =>
  c.startsWith('#')
    ? `rgb(${[1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16)).join(', ')})`
    : c;
const tick = () => new Promise((r) => setTimeout(r, 0));
const tag = (over: Partial<UserTag> & { username: string }): UserTag => ({
  votesUp: 0,
  votesDown: 0,
  voteTally: 0,
  ignored: false,
  updatedAt: 1,
  ...over,
});

describe('colour presets', () => {
  it('has RES’s 21 named presets with their text colours', () => {
    expect(COLOR_PRESETS).toHaveLength(21);
    expect(COLOR_PRESETS[0]).toEqual({ name: 'none', hex: null, text: 'inherit' });
    expect(presetByName('Orange')).toMatchObject({ hex: '#ffa500', text: '#ffffff' });
    expect(presetByName('lime')).toMatchObject({ hex: '#00ff00', text: '#000000' });
    expect(presetByName('nope')).toBeUndefined();
    expect(presetForHex('#FF4500')?.name).toBe('orangered');
  });

  it('uses RES’s text colour for a preset and a computed one otherwise', () => {
    expect(tagTextColor('#ffff00')).toBe('#000000');
    expect(tagTextColor('#0000ff')).toBe('#ffffff'); // RES's pairing reads (8.6:1)
    expect(tagTextColor('#123456')).toBe('#ffffff');
  });

  it('overrides a RES pairing that fails 4.5:1 (white on orange / orangered is 2.1 / 3.4)', () => {
    expect(tagTextColor('#ffa500')).toBe('#000000');
    expect(tagTextColor('#ff4500')).toBe('#000000');
    for (const p of COLOR_PRESETS) {
      if (!p.hex) continue;
      expect(contrastRatio(tagTextColor(p.hex), p.hex)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks pill text by contrast on the blended tint', () => {
    // a light green tint on white needs dark text; a strong one on a dark page needs light text
    expect(pillTextColor('rgba(120, 255, 120, 0.9)', '#ffffff')).toBe('#000000');
    expect(pillTextColor('rgba(0, 120, 0, 1)', '#000000')).toBe('#ffffff');
    expect(pillTextColor('nonsense', '#ffffff')).toBe('#000000');
  });

  it('turns preset table rows into presets and back', () => {
    const rows = [
      { text: ' vip ', color: '#ff0000' },
      { text: 'plain', color: '' },
      { text: '', color: '#00ff00' },
      { text: 'named', color: 'navy' },
      { text: 'bad', color: 'javascript:1' },
      null,
    ];
    expect(presetTagsFrom(rows)).toEqual([
      { text: 'vip', color: '#ff0000' },
      { text: 'plain' },
      { text: 'named', color: '#000080' },
      { text: 'bad' },
    ]);
    expect(presetTagsFrom('junk')).toEqual([]);
    expect(presetRow({ text: 'a' })).toEqual({ text: 'a', color: '' });
    expect(presetRow({ text: 'a', color: '#ff0000' })).toEqual({ text: 'a', color: '#ff0000' });
  });
});

describe('separate up/down vote counts', () => {
  it('migrates a net-only record into up or down votes', () => {
    const t = sanitizeTags({
      pos: { username: 'pos', voteTally: 3 },
      neg: { username: 'neg', voteTally: -2 },
      split: { username: 'split', votesUp: 5, votesDown: 2, voteTally: 99 },
      junk: { username: 'junk', votesUp: -4, votesDown: 'x' },
    });
    expect(t.pos).toMatchObject({ votesUp: 3, votesDown: 0, voteTally: 3 });
    expect(t.neg).toMatchObject({ votesUp: 0, votesDown: 2, voteTally: -2 });
    expect(t.split).toMatchObject({ votesUp: 5, votesDown: 2, voteTally: 3 }); // net is derived
    expect(t.junk).toMatchObject({ votesUp: 0, votesDown: 0, voteTally: 0 });
  });

  it('keeps voteTally equal to up minus down through every change', () => {
    let t = setVotes({}, 'a', 4, 1, NOW);
    expect(t.a).toMatchObject({ votesUp: 4, votesDown: 1, voteTally: 3 });
    t = adjustVotes(t, 'a', -1, 1, NOW); // an upvote swapped for a downvote
    expect(t.a).toMatchObject({ votesUp: 3, votesDown: 2, voteTally: 1 });
    t = adjustVotes(t, 'a', -10, 0, NOW);
    expect(t.a).toMatchObject({ votesUp: 0, votesDown: 2, voteTally: -2 });
    t = setVotes(t, 'a', -3.7, 2.9, NOW);
    expect(t.a).toMatchObject({ votesUp: 0, votesDown: 2 });
    expect(setTally({}, 'b', -3, NOW).b).toMatchObject({ votesUp: 0, votesDown: 3 });
    expect(adjustTally({}, 'c', 2, NOW).c).toMatchObject({ votesUp: 2, votesDown: 0 });
  });

  it('keeps a user whose votes cancel out, and drops a record with nothing in it', () => {
    expect(setVotes({}, 'even', 3, 3, NOW).even).toBeDefined();
    expect(setVotes({}, 'none', 0, 0, NOW).none).toBeUndefined();
  });

  it('formats as "+3 −1"', () => {
    expect(formatVotes(3, 1)).toBe('+3 −1');
    expect(formatVotes(0, 0)).toBe('+0 −0');
  });

  it('colours the pill as RES does: green for upvotes, red for downvotes, white when level', () => {
    expect(voteWeightColor(10, 0)).toBe('rgba(175, 255, 175, 1)');
    expect(voteWeightColor(0, 10)).toBe('rgba(255, 175, 175, 1)');
    expect(voteWeightColor(3, 3)).toBe('rgba(255, 255, 255, 1)');
    // Mixed votes are paler: 4 up 1 down => net 3, share 3/5.
    expect(voteWeightColor(4, 1)).toBe('rgba(231, 255, 231, 0.68)');
    expect(voteWeightColor(500, 0)).toBe('rgba(0, 255, 0, 1)');
  });

  it('works out the change in counts for each kind of vote change', () => {
    expect(voteDeltas(0, 1)).toEqual({ up: 1, down: 0 });
    expect(voteDeltas(0, -1)).toEqual({ up: 0, down: 1 });
    expect(voteDeltas(1, 0)).toEqual({ up: -1, down: 0 });
    expect(voteDeltas(-1, 0)).toEqual({ up: 0, down: -1 });
    expect(voteDeltas(1, -1)).toEqual({ up: -1, down: 1 });
    expect(voteDeltas(-1, 1)).toEqual({ up: 1, down: -1 });
    expect(voteDeltas(1, 1)).toEqual({ up: 0, down: 0 });
  });
});

/** Open the editor against a plain anchor and return handles to its parts. */
function openEditor(over: Partial<EditorRequest> = {}) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const onSave = vi.fn();
  const onDelete = vi.fn();
  openTagEditor({ username: 'alice', current: undefined, anchor, onSave, onDelete, ...over });
  const box = document.querySelector<HTMLElement>('.rescue-tag-editor')!;
  const input = (name: string) => box.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
  const press = (type: string, key: string) =>
    box
      .querySelector('input[name=text]')!
      .dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
  return { anchor, box, input, onSave, onDelete, press };
}

describe('tag editor', () => {
  beforeEach(() => {
    closeTagEditor();
    document.body.innerHTML = '';
  });

  it('offers the 21 swatches; picking one fills the colour and the preview', () => {
    const { box, input } = openEditor();
    const swatches = [...box.querySelectorAll<HTMLButtonElement>('.rescue-swatch')];
    expect(swatches).toHaveLength(21);
    input('text').value = 'vip';
    input('text').dispatchEvent(new Event('input', { bubbles: true }));
    swatches.find((b) => b.dataset.color === 'orangered')!.click();
    expect(input('color').value).toBe('#ff4500');
    const chip = box.querySelector<HTMLElement>('.rescue-tag-preview .rescue-user-tag')!;
    expect(chip.textContent).toBe('vip');
    expect(rgb(chip.style.backgroundColor)).toBe('rgb(255, 69, 0)');
    expect(rgb(chip.style.color)).toBe('rgb(0, 0, 0)'); // RES pairs white, which is only 3.4:1; contrast wins
    expect(
      swatches.find((b) => b.dataset.color === 'orangered')!.getAttribute('aria-pressed'),
    ).toBe('true');
    swatches.find((b) => b.dataset.color === 'none')!.click();
    expect(input('color').value).toBe('');
    expect(
      box.querySelector<HTMLElement>('.rescue-tag-preview .rescue-user-tag')!.style.backgroundColor,
    ).toBe('');
  });

  it('updates the preview as you type text or a colour', () => {
    const { box, input } = openEditor();
    const preview = () => box.querySelector<HTMLElement>('.rescue-tag-preview .rescue-user-tag')!;
    input('text').value = 'hello';
    input('text').dispatchEvent(new Event('input', { bubbles: true }));
    expect(preview().textContent).toBe('hello');
    input('color').value = '#00ff00';
    input('color').dispatchEvent(new Event('input', { bubbles: true }));
    expect(rgb(preview().style.backgroundColor)).toBe('rgb(0, 255, 0)');
    input('color').value = 'garbage';
    input('color').dispatchEvent(new Event('input', { bubbles: true }));
    expect(preview().style.backgroundColor).toBe('');
  });

  it('never renders typed text as markup in the preview', () => {
    const { box, input } = openEditor();
    input('text').value = '<img src=x onerror=alert(1)>';
    input('text').dispatchEvent(new Event('input', { bubbles: true }));
    expect(box.querySelector('.rescue-tag-preview img')).toBeNull();
    expect(box.querySelector('.rescue-tag-preview')!.textContent).toContain('<img');
  });

  it('shows preset chips; clicking one fills text and colour without saving', () => {
    const { box, input, onSave } = openEditor({
      presets: [{ text: 'troll', color: '#ff0000' }, { text: 'plain' }],
    });
    const chips = box.querySelectorAll<HTMLButtonElement>('.rescue-tag-preset');
    expect(chips).toHaveLength(2);
    expect(box.querySelector<HTMLElement>('.rescue-tag-presets')!.hidden).toBe(false);
    chips[0]!.click();
    expect(input('text').value).toBe('troll');
    expect(input('color').value).toBe('#ff0000');
    chips[1]!.click();
    expect(input('text').value).toBe('plain');
    expect(input('color').value).toBe('');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('hides the preset row when there are no presets, and "save as preset" adds one', () => {
    const onSavePreset = vi.fn();
    const { box, input } = openEditor({ presets: [], onSavePreset });
    const row = box.querySelector<HTMLElement>('.rescue-tag-presets')!;
    expect(row.hidden).toBe(true);
    const save = box.querySelector<HTMLButtonElement>('.rescue-tag-save-preset')!;
    save.click(); // no text yet
    expect(box.querySelector<HTMLElement>('.rescue-tag-error')!.hidden).toBe(false);
    expect(onSavePreset).not.toHaveBeenCalled();
    input('text').value = ' friend ';
    input('color').value = '#00ff00';
    save.click();
    expect(onSavePreset).toHaveBeenCalledWith({ text: 'friend', color: '#00ff00' });
    expect(row.hidden).toBe(false);
    expect(row.querySelectorAll('.rescue-tag-preset')).toHaveLength(1);
    save.click(); // the same preset again is not added twice
    expect(row.querySelectorAll('.rescue-tag-preset')).toHaveLength(1);
  });

  it('pre-fills the link with the default only when the user has none, and links to open it', () => {
    const a = openEditor({ defaultLink: 'https://www.reddit.com/r/x/comments/1/t/' });
    expect(a.input('link').value).toBe('https://www.reddit.com/r/x/comments/1/t/');
    const open = a.box.querySelector<HTMLAnchorElement>('.rescue-tag-open')!;
    expect(open.getAttribute('href')).toBe('https://www.reddit.com/r/x/comments/1/t/');
    expect(open.getAttribute('target')).toBe('_blank');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
    a.input('link').value = 'javascript:alert(1)';
    a.input('link').dispatchEvent(new Event('input', { bubbles: true }));
    expect(open.hasAttribute('href')).toBe(false);
    closeTagEditor();

    const b = openEditor({
      defaultLink: 'https://www.reddit.com/new/',
      current: tag({ username: 'alice', text: 't', link: 'https://example.com/mine' }),
    });
    expect(b.input('link').value).toBe('https://example.com/mine');
  });

  it('saves the text, colour, link, ignore flag and the up and down counts', () => {
    const { box, input, onSave } = openEditor({
      current: tag({ username: 'alice', text: 'old', votesUp: 3, votesDown: 1, voteTally: 2 }),
    });
    expect(input('votesUp').value).toBe('3');
    expect(input('votesDown').value).toBe('1');
    input('text').value = 'new';
    input('votesUp').value = '7';
    input('votesDown').value = '-4'; // negatives are clamped
    box.querySelector<HTMLButtonElement>('.rescue-tag-save')!.click();
    expect(onSave).toHaveBeenCalledWith({
      text: 'new',
      color: '',
      link: '',
      ignored: false,
      votesUp: 7,
      votesDown: 0,
    });
    expect(document.querySelector('.rescue-tag-editor')).toBeNull();
  });

  it('submits on Enter (the browser clicks the default button) and closes on Escape', () => {
    const { box, input, onSave } = openEditor();
    const saveBtn = box.querySelector<HTMLButtonElement>('.rescue-tag-save')!;
    // Enter in a field makes the browser click the form's default button: that is a submit button.
    expect(saveBtn.type).toBe('submit');
    expect(saveBtn.form).toBe(box.querySelector('form'));
    input('text').value = 'x';
    saveBtn.click();
    expect(onSave).toHaveBeenCalledOnce();

    closeTagEditor();
    const second = openEditor();
    second.press('keyup', 'Escape');
    expect(document.querySelector('.rescue-tag-editor')).toBeNull();
    closeTagEditor();
    const third = openEditor();
    third.press('keydown', 'Escape');
    expect(document.querySelector('.rescue-tag-editor')).toBeNull();
  });

  it('keeps the Enter key from submitting the page form natively', () => {
    const { box } = openEditor();
    const ev = new Event('submit', { cancelable: true, bubbles: true });
    box.querySelector('form')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('offers a link to the tagged-users manager only when the caller supplies one', () => {
    const none = openEditor();
    expect(none.box.querySelector('.rescue-tag-manage')).toBeNull();
    closeTagEditor();
    const onManage = vi.fn();
    const some = openEditor({ onManage });
    some.box.querySelector<HTMLButtonElement>('.rescue-tag-manage')!.click();
    expect(onManage).toHaveBeenCalledOnce();
    expect(document.querySelector('.rescue-tag-editor')).toBeNull();
  });
});

describe('tagged users manager', () => {
  const TAGS: UserTags = {
    carl: tag({ username: 'Carl', text: 'zebra', votesUp: 1, voteTally: 1, updatedAt: 30 }),
    anna: tag({
      username: 'Anna',
      text: 'friend',
      link: 'https://example.com/anna',
      votesUp: 5,
      votesDown: 2,
      voteTally: 3,
      updatedAt: 10,
    }),
    bert: tag({ username: 'bert', ignored: true, votesDown: 4, voteTally: -4, updatedAt: 20 }),
  };
  const names = (rows: UserTag[]) => rows.map((t) => t.username);

  it('searches user names, tag text and links, case-insensitively', () => {
    expect(names(listTags(TAGS, 'AN', 'name'))).toEqual(['Anna']);
    expect(names(listTags(TAGS, 'zeb', 'name'))).toEqual(['Carl']);
    expect(names(listTags(TAGS, 'example.com', 'name'))).toEqual(['Anna']);
    expect(names(listTags(TAGS, '', 'name'))).toEqual(['Anna', 'bert', 'Carl']);
    expect(listTags(TAGS, 'nothing', 'name')).toEqual([]);
  });

  it('sorts by name, tag text, net votes and recency', () => {
    expect(names(listTags(TAGS, '', 'tag'))).toEqual(['bert', 'Anna', 'Carl']); // '' < friend < zebra
    expect(names(listTags(TAGS, '', 'votes'))).toEqual(['Anna', 'Carl', 'bert']);
    expect(names(listTags(TAGS, '', 'updated'))).toEqual(['Carl', 'bert', 'Anna']);
  });

  function host(initial: UserTags = TAGS) {
    let tags = { ...initial };
    const h: ManagerHost = {
      load: async () => ({ ...tags }),
      edit: vi.fn(),
      remove: vi.fn(async (u: string) => {
        tags = Object.fromEntries(Object.entries(tags).filter(([k]) => k !== u.toLowerCase()));
      }),
    };
    return h;
  }
  const panel = () => document.querySelector<HTMLElement>('.rescue-tags-manager')!;
  const rows = () => [...panel().querySelectorAll<HTMLElement>('tbody tr[data-user]')];

  beforeEach(() => {
    closeTagManager();
    document.body.innerHTML = '';
  });

  it('lists every tag with the tag chip, votes and ignored state', async () => {
    openTagManager(host());
    await tick();
    expect(rows().map((r) => r.dataset.user)).toEqual(['anna', 'bert', 'carl']);
    const anna = rows()[0]!;
    expect(anna.querySelector('.rescue-user-tag')!.textContent).toBe('friend');
    expect(anna.textContent).toContain('+5 −2');
    expect(rows()[1]!.querySelector('.rescue-tags-ignored')).not.toBeNull();
    expect(panel().querySelector('.rescue-tags-count')!.textContent).toBe('3 tagged users');
  });

  it('filters and re-sorts from the controls', async () => {
    openTagManager(host());
    await tick();
    const search = panel().querySelector<HTMLInputElement>('input[name=search]')!;
    search.value = 'friend';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows().map((r) => r.dataset.user)).toEqual(['anna']);
    expect(panel().querySelector('.rescue-tags-count')!.textContent).toBe('1 of 3 tagged users');
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const sort = panel().querySelector<HTMLSelectElement>('select[name=sort]')!;
    sort.value = 'updated';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
    expect(rows().map((r) => r.dataset.user)).toEqual(['carl', 'bert', 'anna']);
  });

  it('edit hands the user and the button to the host', async () => {
    const hst = host();
    openTagManager(hst);
    await tick();
    const btn = rows()[0]!.querySelector<HTMLButtonElement>('.rescue-tags-edit')!;
    btn.click();
    expect(hst.edit).toHaveBeenCalledWith('Anna', btn);
  });

  it('delete asks "Sure?" first, then removes and redraws', async () => {
    const hst = host();
    openTagManager(hst);
    await tick();
    rows()[0]!.querySelector<HTMLButtonElement>('.rescue-tags-delete')!.click();
    expect(hst.remove).not.toHaveBeenCalled();
    const sure = rows()[0]!.querySelector<HTMLButtonElement>('.rescue-tags-delete')!;
    expect(sure.textContent).toBe('Sure?');
    sure.click();
    await tick();
    await tick();
    expect(hst.remove).toHaveBeenCalledWith('Anna');
    expect(rows().map((r) => r.dataset.user)).toEqual(['bert', 'carl']);
  });

  it('refreshes on demand, shows an empty state, and closes with Escape or the button', async () => {
    const hst = host({});
    openTagManager(hst);
    await tick();
    expect(panel().textContent).toContain('No users tagged yet.');
    refreshTagManager();
    await tick();
    expect(panel()).not.toBeNull();
    panel().dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.rescue-tags-manager')).toBeNull();
    openTagManager(hst);
    panel().querySelector<HTMLButtonElement>('.rescue-tags-close')!.click();
    expect(document.querySelector('.rescue-tags-manager')).toBeNull();
  });

  it('writes user text as text, never markup', async () => {
    openTagManager(host({ x: tag({ username: 'x', text: '<img src=x onerror=alert(1)>' }) }));
    await tick();
    expect(panel().querySelector('img')).toBeNull();
    expect(panel().textContent).toContain('<img');
  });
});

describe('vote counter', () => {
  /** A post with Reddit-style vote buttons in an open shadow root. */
  function post(pressed: { up?: boolean; down?: boolean } = {}) {
    document.body.innerHTML = '<div id="t3_a"></div>';
    const host = document.getElementById('t3_a')!;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<button upvote aria-pressed="${!!pressed.up}"><svg></svg></button><button downvote aria-pressed="${!!pressed.down}"></button>`;
    return {
      host,
      up: root.querySelector<HTMLElement>('button[upvote]')!,
      down: root.querySelector<HTMLElement>('button[downvote]')!,
    };
  }

  function setup(opts: { me?: string | null; author?: string | null } = {}) {
    const state = { value: 0 as -1 | 0 | 1 | null };
    const apply = vi.fn();
    const sleep = vi.fn(async () => {});
    const stop = attachVoteCounter({
      itemFor: (el) =>
        el.id === 't3_a'
          ? { id: 't3_a', author: 'author' in opts ? opts.author! : 'target' }
          : undefined,
      me: () => (opts.me === undefined ? 'me' : opts.me),
      voteState: async () => state.value,
      apply,
      acceptUntrusted: true,
      confirmMs: 600,
      pollMs: 150,
      sleep,
    });
    return { state, apply, stop };
  }

  const flush = async () => {
    for (let i = 0; i < 20; i++) await tick();
  };

  it('counts an upvote once Reddit shows it', async () => {
    const { up } = post();
    const { state, apply, stop } = setup();
    up.click();
    state.value = 1; // Reddit flips aria-pressed after the click
    await flush();
    expect(apply).toHaveBeenCalledExactlyOnceWith('target', 1, 0);
    stop();
  });

  it('counts a click on something inside the arrow (its icon)', async () => {
    const { up } = post();
    const { state, apply, stop } = setup();
    up.querySelector('svg')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true }),
    );
    state.value = 1;
    await flush();
    expect(apply).toHaveBeenCalledWith('target', 1, 0);
    stop();
  });

  it('counts a downvote, and removing a vote takes it back', async () => {
    const a = post();
    const s = setup();
    a.down.click();
    s.state.value = -1;
    await flush();
    expect(s.apply).toHaveBeenLastCalledWith('target', 0, 1);
    s.stop();

    const b = post({ down: true });
    const t = setup();
    t.state.value = -1;
    b.down.click(); // clicking the pressed arrow clears the vote
    t.state.value = 0;
    await flush();
    expect(t.apply).toHaveBeenCalledExactlyOnceWith('target', 0, -1);
    t.stop();
  });

  it('counts a switch from up to down as one up less and one down more', async () => {
    const { down } = post({ up: true });
    const { state, apply, stop } = setup();
    state.value = 1;
    down.click();
    state.value = -1;
    await flush();
    expect(apply).toHaveBeenCalledExactlyOnceWith('target', -1, 1);
    stop();
  });

  it('counts nothing when Reddit never applies the vote', async () => {
    const { up } = post();
    const { apply, stop } = setup();
    up.click(); // the state stays 0
    await flush();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it('counts nothing when the state is unreadable', async () => {
    const { up } = post();
    const { state, apply, stop } = setup();
    state.value = null;
    up.click();
    await flush();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it('ignores votes on your own posts, signed-out clicks and posts with no author', async () => {
    for (const opts of [{ author: 'ME' }, { me: null }, { author: null }]) {
      const { up } = post();
      const { state, apply, stop } = setup(opts);
      up.click();
      state.value = 1;
      await flush();
      expect(apply).not.toHaveBeenCalled();
      stop();
    }
  });

  it('ignores arrows when the pressed state cannot be read before the click', async () => {
    const { up } = post();
    up.removeAttribute('aria-pressed');
    const { state, apply, stop } = setup();
    up.click();
    state.value = 1;
    await flush();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it('ignores synthetic clicks (REScue’s own keyboard vote) unless told otherwise, so nothing double counts', async () => {
    const { up } = post();
    const apply = vi.fn();
    const stop = attachVoteCounter({
      itemFor: (el) => (el.id === 't3_a' ? { id: 't3_a', author: 'target' } : undefined),
      me: () => 'me',
      voteState: async () => 1,
      apply,
      sleep: async () => {},
    });
    up.click(); // element.click() is what the keyboard path does: not a trusted event
    await flush();
    expect(apply).not.toHaveBeenCalled();
    stop();
  });

  it('ignores clicks elsewhere and stops when detached', async () => {
    const { up } = post();
    const { state, apply, stop } = setup();
    document.body.click();
    stop();
    up.click();
    state.value = 1;
    await flush();
    expect(apply).not.toHaveBeenCalled();
  });

  it('does not count one post twice while the first vote is being confirmed', async () => {
    const { up, down } = post();
    const { state, apply, stop } = setup();
    up.click();
    down.click();
    state.value = 1;
    await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    stop();
  });
});

/** userTagger against real fixtures, with a session, settings and recorded saves. */
async function boot(
  stored: unknown,
  options: Record<string, OptionValue> = {},
  extra: Partial<ModuleContext> = {},
) {
  const deco = new Decorations();
  const adapter = new NativeAdapter(deco);
  const store: Record<string, unknown> = { userTags: stored };
  const ui = {
    addMenuItem: () => () => {},
    openMenu: () => {},
    hide: (i, r) => deco.hide(i, r),
    unhide: (i, r) => deco.unhide(i, r),
    collapseBody: (i, on) => deco.collapseBody(i, on),
    markAuthor: (i, c) => deco.markAuthor(i, c),
    unmarkAuthor: (i, c) => deco.unmarkAuthor(i, c),
    decorate: (i, s, n) => deco.decorate(i, s, n),
    removeDecorations: (k) => deco.removeKind(k),
    addClass: (i, c) => deco.addClass(i, c),
    setRevealHidden: (on) => deco.setReveal(on),
    addHeaderTool: () => {},
    addBanner: () => {},
    selection: () => undefined as never,
  } as ModuleUi;
  const saves: unknown[] = [];
  const profile = {
    schemaVersion: 1,
    modules: { userTagger: { options } },
    keybindings: {},
    syncEnabled: false,
  };
  const ctx = {
    moduleId: 'userTagger',
    options: resolveOptions(userTagger, profile as never),
    route: { kind: 'thread', path: '/' },
    session: { signedIn: true, username: 'me_the_reader' },
    ui,
    notices: { show: vi.fn(), dismiss: vi.fn() },
    actions: { voteState: async () => null },
    settings: {
      profile: () => profile,
      save: async (p: unknown) => void saves.push(p),
    },
    data: {
      get: async (k: string) => store[k],
      set: (k: string, v: unknown) => void (store[k] = v),
    },
    ...extra,
  } as unknown as ModuleContext;
  await userTagger.init!(ctx as never);
  const deliver = (batch: Partial<ItemBatch>) => {
    const full = { posts: [], comments: [], profileComments: [], ...batch };
    userTagger.onItems!(full, ctx as never);
    adapter.track(full);
  };
  return { ctx, deliver, store, saves };
}

const quiet = () => userTagger.dispose!();

describe('userTagger parity behaviours', () => {
  beforeEach(() => {
    closeTagEditor();
    closeTagManager();
    mount(nestedThreadHtml());
  });

  it('puts no tag button or vote pill on the signed-in user’s own name, but still shows their tag', async () => {
    const mine = {
      user2: tag({ username: 'user2', text: 'me', votesUp: 2, voteTally: 2 }),
    };
    const { deliver, ctx } = await boot(mine);
    (ctx.session as { username: string }).username = 'USER2'; // case-insensitive
    deliver({ comments: parseComments(document, null) });
    expect(document.querySelectorAll('button[aria-label="Tag user2"]')).toHaveLength(0);
    expect(document.querySelector('.rescue-vote-tally')).toBeNull();
    expect(document.querySelector('.rescue-user-tag[data-user="user2"]')!.textContent).toBe('me');
    expect(document.querySelectorAll('button[aria-label="Tag user0"]').length).toBeGreaterThan(0);
    quiet();
  });

  it('hides the tag icon when switched off, except next to already-tagged users', async () => {
    const { deliver } = await boot(
      { user2: tag({ username: 'user2', text: 'known' }) },
      { showTaggingIcon: false },
    );
    deliver({ comments: parseComments(document, null) });
    expect(document.querySelectorAll('button[aria-label="Tag user2"]').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('button[aria-label="Tag user0"]')).toHaveLength(0);
    quiet();
  });

  it('truncates long tags (with the full text in the title) unless switched off', async () => {
    const long = 'x'.repeat(80);
    const stored = { user2: tag({ username: 'user2', text: long }) };
    const a = await boot(stored);
    a.deliver({ comments: parseComments(document, null) });
    const chip = document.querySelector<HTMLElement>('.rescue-user-tag[data-user="user2"]')!;
    expect(chip.classList.contains('rescue-truncate')).toBe(true);
    expect(chip.title).toContain(long);
    quiet();

    mount(nestedThreadHtml());
    const b = await boot(stored, { truncateTag: false });
    b.deliver({ comments: parseComments(document, null) });
    expect(
      document
        .querySelector('.rescue-user-tag[data-user="user2"]')!
        .classList.contains('rescue-truncate'),
    ).toBe(false);
    quiet();
  });

  it('shows "+3 −1" in a pill coloured by vote weight, and the option turns the colour off', async () => {
    const stored = { user2: tag({ username: 'user2', votesUp: 3, votesDown: 1, voteTally: 2 }) };
    const a = await boot(stored);
    a.deliver({ comments: parseComments(document, null) });
    const pill = document.querySelector<HTMLElement>('.rescue-vote-tally')!;
    expect(pill.textContent).toBe('+3 −1');
    // net 2 of 4 votes: pale green (r = b = 255 - 16), alpha 0.2 + 0.8 * 2/4
    expect(pill.style.backgroundColor).toBe('rgba(239, 255, 239, 0.6)');
    expect(pill.title).toContain('+3 −1');
    quiet();

    mount(nestedThreadHtml());
    const b = await boot(stored, { colorVoteWeight: false });
    b.deliver({ comments: parseComments(document, null) });
    expect(document.querySelector<HTMLElement>('.rescue-vote-tally')!.style.backgroundColor).toBe(
      '',
    );
    quiet();

    mount(nestedThreadHtml());
    const c = await boot(stored, { trackVoteWeight: false });
    c.deliver({ comments: parseComments(document, null) });
    expect(document.querySelector('.rescue-vote-tally')).toBeNull();
    quiet();
  });

  it('opens the editor from a comment with the comment’s permalink as the link', async () => {
    const { deliver } = await boot({});
    const comments = parseComments(document, null);
    deliver({ comments });
    const c = comments.find((x) => x.author === 'user2')!;
    expect(c.permalink).toBeTruthy();
    c.source.querySelector<HTMLButtonElement>('button[aria-label="Tag user2"]')!.click();
    const link = document.querySelector<HTMLInputElement>('.rescue-tag-editor input[name=link]')!;
    expect(new URL(link.value).pathname).toBe(new URL(c.permalink!, location.origin).pathname);
    expect(link.value.startsWith('http')).toBe(true);
    quiet();
  });

  it('leaves the link empty when "pre-fill" is off, and saves the typed link and counts', async () => {
    const { deliver, store } = await boot({}, { storeSourceLink: false });
    deliver({ comments: parseComments(document, null) });
    document.querySelector<HTMLButtonElement>('button[aria-label="Tag user2"]')!.click();
    const editor = document.querySelector('.rescue-tag-editor')!;
    expect(editor.querySelector<HTMLInputElement>('input[name=link]')!.value).toBe('');
    editor.querySelector<HTMLInputElement>('input[name=text]')!.value = 'pal';
    editor.querySelector<HTMLInputElement>('input[name=votesUp]')!.value = '4';
    editor.querySelector<HTMLInputElement>('input[name=votesDown]')!.value = '2';
    editor.querySelector<HTMLButtonElement>('.rescue-tag-save')!.click();
    await tick();
    await tick();
    expect(store.userTags).toMatchObject({
      user2: { text: 'pal', votesUp: 4, votesDown: 2, voteTally: 2 },
    });
    expect(document.querySelector('.rescue-vote-tally')!.textContent).toBe('+4 −2');
    quiet();
  });

  it('applies a post’s permalink when tagging from a post', async () => {
    mount(listingHtml());
    const post = parsePost(document.querySelector('shreddit-post#t3_text1')!)!;
    const { deliver } = await boot({});
    deliver({ posts: [post] });
    document.querySelector<HTMLButtonElement>('button[aria-label="Tag rockpaperblr"]')!.click();
    const value = document.querySelector<HTMLInputElement>(
      '.rescue-tag-editor input[name=link]',
    )!.value;
    expect(value).toMatch(/^https?:\/\/.*\/r\/Layoffs\/comments\/text1\/got_laid_off\/$/);
    quiet();
  });

  it('offers preset tags from the options, and saves a new one back to the settings', async () => {
    const { deliver, saves } = await boot(
      {},
      { presetTags: [{ text: 'troll', color: '#ff0000' }] },
    );
    deliver({ comments: parseComments(document, null) });
    document.querySelector<HTMLButtonElement>('button[aria-label="Tag user2"]')!.click();
    const editor = document.querySelector('.rescue-tag-editor')!;
    const presets = editor.querySelectorAll('.rescue-tag-preset');
    expect(presets).toHaveLength(1);
    expect(presets[0]!.textContent).toBe('troll');

    editor.querySelector<HTMLInputElement>('input[name=text]')!.value = 'regular';
    editor.querySelector<HTMLInputElement>('input[name=color]')!.value = '#00ff00';
    editor.querySelector<HTMLButtonElement>('.rescue-tag-save-preset')!.click();
    await tick();
    expect(saves).toHaveLength(1);
    expect(
      (saves[0] as { modules: { userTagger: { options: { presetTags: unknown } } } }).modules
        .userTagger.options.presetTags,
    ).toEqual([
      { text: 'troll', color: '#ff0000' },
      { text: 'regular', color: '#00ff00' },
    ]);
    quiet();
  });

  it('records votes as separate counts, ignoring them when counting is off', async () => {
    const a = await boot({});
    a.deliver({ comments: parseComments(document, null) });
    await recordVotes('user2', 1, 0);
    await recordVotes('user2', -1, 1); // changed an upvote into a downvote
    await recordVotes('user2', 0, 1);
    expect(a.store.userTags).toMatchObject({ user2: { votesUp: 0, votesDown: 2, voteTally: -2 } });
    expect(document.querySelector('.rescue-vote-tally')!.textContent).toBe('+0 −2');
    quiet();

    mount(nestedThreadHtml());
    const b = await boot({}, { trackVoteWeight: false });
    b.deliver({ comments: parseComments(document, null) });
    await recordVotes('user2', 1, 0);
    expect(b.store.userTags).toEqual({});
    quiet();
  });

  it('offers a "Manage tagged users" action that lists tags from storage', async () => {
    const { ctx } = await boot({ user2: tag({ username: 'user2', text: 'known' }) });
    const action = userTagger.actions!.find((a) => a.id === 'manage')!;
    await action.run(ctx as never);
    await tick();
    await tick();
    const row = document.querySelector('.rescue-tags-manager tr[data-user="user2"]');
    expect(row).not.toBeNull();
    // Editing from the manager saves through the tagger and redraws the list.
    row!.querySelector<HTMLButtonElement>('.rescue-tags-edit')!.click();
    const editor = document.querySelector('.rescue-tag-editor')!;
    editor.querySelector<HTMLInputElement>('input[name=text]')!.value = 'renamed';
    editor.querySelector<HTMLButtonElement>('.rescue-tag-save')!.click();
    await tick();
    await tick();
    await tick();
    expect(
      document.querySelector('.rescue-tags-manager tr[data-user="user2"]')!.textContent,
    ).toContain('renamed');
    quiet();
  });

  it('migrates an old net-tally record on load', async () => {
    const { deliver } = await boot({
      user2: { username: 'user2', text: 'old', voteTally: -2, ignored: false, updatedAt: 1 },
    });
    deliver({ comments: parseComments(document, null) });
    expect(document.querySelector('.rescue-vote-tally')!.textContent).toBe('+0 −2');
    quiet();
  });
});
