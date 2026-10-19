/**
 * Comment tweaks: thread-line colour/width, reply indent, score highlighting, the “upvoted”
 * navigator category and the “load more replies” key.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { commentQuickCollapse, quickCollapseCss } from '../../src/modules/comments/commentQuickCollapse';
import { commentStyleCss } from '../../src/modules/comments/commentStyle';
import { commentNavigator } from '../../src/modules/comments/commentNavigator';
import {
  matchesCategory,
  type NavSets,
} from '../../src/modules/comments/navigatorFilters';
import { highlightScoresCss, voteEnhancements } from '../../src/modules/actions/voteEnhancements';
import {
  keyboardNavExtras,
  selectedMoreReplies,
} from '../../src/modules/listings/keyboardNavExtras';
import { commentUpvoted, ownMoreRepliesControl } from '../../src/model/commentRow';
import {
  addCommentRow,
  addMoreReplies,
  mount,
  nestedThreadHtml,
  threadComments,
} from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

const commentEls = (): Element[] => [...document.querySelectorAll('shreddit-comment')];

const baseSets = (over: Partial<NavSets> = {}): NavSets => ({
  friends: new Set(),
  tagged: new Set(),
  popularScore: 100,
  isNew: () => false,
  ...over,
});

describe('commentQuickCollapse left edge', () => {
  it('is empty by default and draws colour, hover, collapsed and width rules on request', () => {
    expect(quickCollapseCss({})).toBe('');
    const css = quickCollapseCss({
      leftEdgeColor: '#ff0000',
      leftEdgeHoverColor: '#00ff00',
      leftEdgeCollapsedColor: '#0000ff',
      leftEdgeWidth: 4,
    });
    expect(css).toContain('shreddit-comment div.threadline-strip { background-color: #ff0000; }');
    expect(css).toContain('div.threadline-strip:hover { background-color: #00ff00; }');
    expect(css).toContain(
      'shreddit-comment[collapsed] div.threadline-strip { background-color: #0000ff; }',
    );
    expect(css).toContain('width: 4px');
    // A bad colour and a zero width are ignored rather than written into the sheet.
    expect(quickCollapseCss({ leftEdgeColor: 'red;}x{', leftEdgeWidth: 0 })).toBe('');
  });

  it('adds one stylesheet and removes it on dispose', async () => {
    const m = await bootModules([commentQuickCollapse], {
      options: { commentQuickCollapse: { leftEdgeColor: '#ff0000' } },
    });
    expect(document.getElementById('rescue-comment-quick-collapse')!.textContent).toContain(
      '#ff0000',
    );
    m.dispose();
    expect(document.getElementById('rescue-comment-quick-collapse')).toBeNull();
  });
});

describe('commentStyle indent', () => {
  it('moves nested replies by the chosen amount and leaves the top level alone', () => {
    const base = { commentBoxes: false, commentRounded: false, commentHoverBorder: false };
    expect(commentStyleCss({ ...base, commentIndent: 24 })).toContain(
      'shreddit-comment[depth]:not([depth="0"]) { margin-left: 24px; }',
    );
    expect(commentStyleCss({ ...base, commentIndent: -12 })).toContain('margin-left: -12px');
    expect(commentStyleCss({ ...base, commentIndent: 0 })).toBe('');
  });
});

describe('voteEnhancements highlightScores', () => {
  it('is empty when off and bolds REScue’s own score chip when on', () => {
    expect(highlightScoresCss(false)).toBe('');
    expect(highlightScoresCss(true)).toContain('font-weight: 700');
  });

  it('adds the stylesheet through the module and removes it on dispose', async () => {
    const m = await bootModules([voteEnhancements], {
      options: { voteEnhancements: { highlightScores: true } },
    });
    expect(document.getElementById('rescue-highlight-scores')!.textContent).toContain(
      '.rescue-score-chip',
    );
    m.dispose();
    expect(document.getElementById('rescue-highlight-scores')).toBeNull();
  });
});

describe('upvoted navigator category', () => {
  it('defers to the supplied check', () => {
    const c = { ...baseComment(), id: 't1_x' };
    expect(matchesCategory(c, 'upvoted', baseSets({ upvoted: (x) => x.id === 't1_x' }))).toBe(true);
    expect(matchesCategory(c, 'upvoted', baseSets({ upvoted: () => false }))).toBe(false);
    expect(matchesCategory(c, 'upvoted', baseSets())).toBe(false);
  });

  it('reads the vote from the action row and steps to it', async () => {
    mount(nestedThreadHtml(threadComments()));
    const route = { kind: 'thread', path: '/r/Layoffs/comments/text1/x', postId: 't3_text1' };
    const m = await bootModules([commentNavigator], {
      route,
      options: { commentNavigator: { showByDefault: true } },
    });
    m.flush();
    await tick();
    const [a] = commentEls();
    addCommentRow(a!, { upvoted: true });

    const widget = document.querySelector<HTMLElement>('.rescue-comment-nav')!;
    const select = widget.querySelector('select')!;
    select.value = 'upvoted';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    widget.querySelector<HTMLButtonElement>('.rescue-nav-next')!.click();
    await tick();
    expect(m.selection.current()?.id).toBe('t1_c0');
    m.dispose();
  });
});

describe('commentUpvoted / ownMoreRepliesControl', () => {
  it('reads aria-pressed from the row’s open shadow root, null until the row appears', () => {
    mount(nestedThreadHtml(threadComments()));
    const [a, b] = commentEls();
    expect(commentUpvoted(a!)).toBeNull();
    addCommentRow(a!, { upvoted: true });
    addCommentRow(b!, { upvoted: false });
    expect(commentUpvoted(a!)).toBe(true);
    expect(commentUpvoted(b!)).toBe(false);
  });

  it('finds only the comment’s own “N more replies”, never a reply’s or another button', () => {
    mount(nestedThreadHtml(threadComments()));
    const [a, b] = commentEls();
    const mine = addMoreReplies(a!, 3);
    const theirs = addMoreReplies(b!, 2);
    const other = document.createElement('button');
    other.textContent = 'reply';
    a!.appendChild(other);
    expect(ownMoreRepliesControl(a!)).toBe(mine);
    expect(ownMoreRepliesControl(b!)).toBe(theirs);
  });
});

describe('loadChildComments key', () => {
  it('clicks the selected comment’s own “more replies”, and does nothing otherwise', async () => {
    mount(nestedThreadHtml(threadComments()));
    const [a] = commentEls();
    const button = addMoreReplies(a!, 3);
    const m = await bootModules([keyboardNavExtras], { route: { kind: 'thread', path: '/' } });
    m.flush();
    expect(m.keys.run('loadChildComments')).toBe(false); // nothing selected yet
    m.selection.select('t1_c0');
    expect(selectedMoreReplies(m.ctxs.get('keyboardNavExtras')!)).toBe(button);
    expect(m.keys.run('loadChildComments')).toBe(true);
    expect(button.getAttribute('data-clicked')).toBe('');
    m.dispose();
  });
});

function baseComment() {
  return {
    kind: 'comment' as const,
    id: 't1_x',
    postId: 't3_p',
    parentId: null,
    depth: 0,
    author: 'someone',
    isOp: false,
    distinguished: null,
    score: 1,
    created: new Date(1000),
    bodyHtml: '<p>hello</p>',
    permalink: null,
    source: document.createElement('div'),
  };
}
