import { beforeEach, describe, expect, it } from 'vitest';
import { Decorations } from '../../src/layout/decorations';
import { NativeAdapter } from '../../src/layout/native/adapter';
import { parseComments } from '../../src/model/comment';
import { parsePost } from '../../src/model/post';
import { parseProfileComment } from '../../src/model/profile-comment';
import type { Comment, Post } from '../../src/model/types';
import {
  flatThreadHtml,
  listingHtml,
  mount,
  nestedThreadHtml,
  profileCommentsHtml,
  postHtml,
} from '../fixtures/pages';

const span = (text: string) => {
  const s = document.createElement('span');
  s.className = 'deco-test';
  s.textContent = text;
  return s;
};
const decoCount = (root: ParentNode = document) => root.querySelectorAll('.deco-test').length;
/** A post's authorName wrapper and its relative time (the live-verified inline anchors). */
const authorWrap = (p: Post) => p.source.querySelector('[slot="authorName"]')!;
const timeOf = (p: Post) => p.source.querySelector('faceplate-timeago')!;

function setup() {
  const deco = new Decorations();
  const adapter = new NativeAdapter(deco);
  return { deco, adapter };
}

const postOf = (id: string): Post =>
  parsePost(document.querySelector(`shreddit-post#${id}`)!) as Post;
const commentsOf = (): Comment[] => parseComments(document, null);
/** Reddit's own slot element on an item (its credit bar, title, meta line). */
const own = (host: Element, slot: string): Element =>
  [...host.querySelectorAll(`[slot="${slot}"]`)].find(
    (el) =>
      el.parentElement?.closest('shreddit-post, shreddit-comment, shreddit-profile-comment') ===
      host,
  )!;
const batch = (o: Partial<Parameters<NativeAdapter['track']>[0]>) => ({
  posts: [],
  comments: [],
  profileComments: [],
  ...o,
});

describe('signed-in listing credit bar (no authorName wrapper; verified live 2026-10-15)', () => {
  // Avatar link (no text) first, then the name link inside an li of a flex ul.
  const signedInPost = () =>
    `<article><shreddit-post id="t3_si1" post-title="Signed in" permalink="/r/x/comments/si1/y/" post-type="text" author="fykup" subreddit-name="x" score="1" comment-count="0">` +
    `<span slot="credit-bar"><span><div>` +
    `<span><faceplate-hovercard><faceplate-tracker><a href="https://www.reddit.com/user/fykup/" aria-label="View fykup"><img alt=""></a></faceplate-tracker></faceplate-hovercard></span>` +
    `<ul><li><faceplate-tracker><a href="https://www.reddit.com/user/fykup/">u/fykup</a></faceplate-tracker></li>` +
    `<li><faceplate-timeago><time>1h</time></faceplate-timeago></li></ul>` +
    `</div></span></span><a slot="title" href="/r/x/comments/si1/y/">Signed in</a></shreddit-post></article>`;
  beforeEach(() => mount(`<shreddit-feed>${signedInPost()}</shreddit-feed>`));

  it('author nodes go at the end of the author’s own li, never after the avatar link', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_si1');
    adapter.track(batch({ posts: [post] }));
    const a = span('A');
    deco.decorate(post, 'author', a);
    const nameLink = [...post.source.querySelectorAll('a[href*="/user/"]')][1]!;
    expect(a.parentElement).toBe(nameLink.closest('li'));
    expect(a.previousElementSibling).toBe(nameLink.closest('faceplate-tracker'));
    expect(a.hasAttribute('slot')).toBe(false);
  });

  it('markAuthor marks the name link, not the avatar link', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_si1');
    adapter.track(batch({ posts: [post] }));
    deco.markAuthor(post, 'rescue-x');
    const [avatar, name] = [...post.source.querySelectorAll('a[href*="/user/"]')];
    expect(name!.classList.contains('rescue-x')).toBe(true);
    expect(avatar!.classList.contains('rescue-x')).toBe(false);
  });

  it('repeated apply keeps a single author node in the li', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_si1');
    adapter.track(batch({ posts: [post] }));
    deco.decorate(post, 'author', span('A'));
    for (let i = 0; i < 3; i++) adapter.apply(post.id);
    expect(decoCount(post.source)).toBe(1);
  });
});

describe('native decorations on posts', () => {
  beforeEach(() => mount(listingHtml()));

  it('places author after the authorName wrapper, tagline after the time, title after Reddit’s title', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    const a = span('A');
    const t = span('T');
    const ti = span('TI');
    a.setAttribute('slot', 'stale');
    deco.decorate(post, 'author', a);
    deco.decorate(post, 'tagline', t);
    deco.decorate(post, 'title', ti);

    // Live 2026-10-15: the link sits in a block-level tracker (a node after it wraps), and the
    // credit bar is a two-group row (a third child reflows it); the post's shadow root on listings
    // has no credit-bar/title slot at all.
    expect(authorWrap(post).nextSibling).toBe(a);
    expect(a.hasAttribute('slot')).toBe(false);
    expect(timeOf(post).nextSibling).toBe(t);
    expect(t.hasAttribute('slot')).toBe(false);
    const title = own(post.source, 'title');
    expect(title.nextSibling).toBe(ti);
    // A title that is a direct child of the post (thread pages) passes its slot on to the sibling.
    expect(ti.getAttribute('slot')).toBe(title.parentElement === post.source ? 'title' : null);
    // The row that holds the time wraps, so a narrow thread header does not clip the new words.
    expect((timeOf(post).parentElement as HTMLElement).style.flexWrap).toBe('wrap');
  });

  it('a title decoration follows a title wrapped in a container (listing layout)', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    const title = own(post.source, 'title');
    const wrap = document.createElement('div');
    title.replaceWith(wrap);
    wrap.append(title);
    adapter.track(batch({ posts: [post] }));
    const ti = span('TI');
    deco.decorate(post, 'title', ti);
    expect(title.nextSibling).toBe(ti);
    expect(ti.hasAttribute('slot')).toBe(false);
  });

  it('slots onto the post only when Reddit has no credit-bar element', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    own(post.source, 'credit-bar').remove();
    adapter.track(batch({ posts: [post] }));
    const t = span('T');
    deco.decorate(post, 'tagline', t);
    expect(t.parentElement).toBe(post.source);
    expect(t.getAttribute('slot')).toBe('credit-bar');
  });

  it('hides the feed article while decorating the shreddit-post itself', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    const t = span('T');
    deco.decorate(post, 'tagline', t);
    deco.hide(post, 'keyword');
    const article = post.source.closest('article')!;
    expect(article.getAttribute('data-rescue-hidden')).toBe('keyword');
    expect(t.closest('shreddit-post')).toBe(post.source);
  });

  it('is idempotent: repeated apply never duplicates or moves a placed node', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    deco.decorate(post, 'author', span('A'));
    deco.decorate(post, 'tagline', span('T'));
    for (let i = 0; i < 3; i++) adapter.apply(post.id);
    adapter.track(batch({ posts: [post] }));
    expect(decoCount(post.source)).toBe(2);
    expect(decoCount(own(post.source, 'credit-bar'))).toBe(2);
  });

  it('re-inserts a detached node', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    const a = span('A');
    const t = span('T');
    deco.decorate(post, 'author', a);
    deco.decorate(post, 'tagline', t);
    a.remove();
    t.remove();
    adapter.apply(post.id);
    expect(a.isConnected).toBe(true);
    expect(authorWrap(post).nextSibling).toBe(a);
    expect(timeOf(post).nextSibling).toBe(t);
  });

  it('follows a re-rendered author link', () => {
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    const bar = post.source.querySelector('[slot="credit-bar"]')!;
    const markup = bar.innerHTML; // Reddit's own markup, before REScue touched it
    const a = span('A');
    deco.decorate(post, 'author', a);
    bar.innerHTML = markup; // Reddit re-renders the credit bar; our node is gone
    expect(a.isConnected).toBe(false);
    adapter.apply(post.id);
    expect(authorWrap(post).nextSibling).toBe(a);
    expect(decoCount(post.source)).toBe(1);
  });

  it('falls back to the tagline placement when the author link is missing', () => {
    mount(listingHtml([{ id: 't3_gone', type: 'text', title: 'No author', permalink: '/x/' }]));
    const { deco, adapter } = setup();
    const post = postOf('t3_gone');
    adapter.track(batch({ posts: [post] }));
    const a = span('A');
    deco.decorate(post, 'author', a);
    // This fixture has no credit bar either, so the node is slotted onto the post as a last resort.
    expect(a.parentElement).toBe(post.source);
    expect(a.getAttribute('slot')).toBe('credit-bar');
  });

  it('decorates a post added later through its own wrapper', () => {
    const { deco, adapter } = setup();
    document.querySelector('shreddit-feed')!.insertAdjacentHTML(
      'beforeend',
      postHtml({
        id: 't3_late',
        type: 'text',
        title: 'Late',
        permalink: '/r/x/comments/late/y/',
        domain: 'self.x',
        sub: 'x',
        author: 'late_user',
      }),
    );
    const post = postOf('t3_late');
    adapter.track(batch({ posts: [post] }));
    const a = span('A');
    deco.decorate(post, 'author', a);
    expect(
      post.source.querySelector('a[href="/user/late_user/"]')!.closest('[slot="authorName"]')!
        .nextSibling,
    ).toBe(a);
  });
});

describe.each([
  ['flat', () => flatThreadHtml()],
  ['nested', () => nestedThreadHtml()],
  ['nested, children first', () => nestedThreadHtml(undefined, true)],
])('native decorations on comments (%s)', (_name, html) => {
  beforeEach(() => mount(html()));

  it('places author after the comment’s own author link, tagline and title inside its own meta line', () => {
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    const c = comments.find((x) => x.id === 't1_c1')!;
    const a = span('A');
    const t = span('T');
    const ti = span('TI');
    deco.decorate(c, 'author', a);
    deco.decorate(c, 'tagline', t);
    deco.decorate(c, 'title', ti);

    const link = [...c.source.querySelectorAll('a[href^="/user/"]')].find(
      (l) => l.closest('shreddit-comment') === c.source,
    )!;
    expect(link.getAttribute('href')).toBe(`/user/${c.author}/`);
    expect(link.nextSibling).toBe(a);
    for (const n of [t, ti]) {
      expect(n.parentElement).toBe(own(c.source, 'commentMeta'));
      expect(n.hasAttribute('slot')).toBe(false);
    }
  });

  it('lets the meta line wrap so REScue’s words are not clipped on a narrow page', () => {
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    const c = comments.find((x) => x.id === 't1_c1')!;
    deco.decorate(c, 'author', span('A'));
    expect((own(c.source, 'commentMeta') as HTMLElement).style.flexWrap).toBe('wrap');
  });

  it('is idempotent and re-inserts a detached node', () => {
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    const c = comments[2]!;
    const a = span('A');
    const t = span('T');
    deco.decorate(c, 'author', a);
    deco.decorate(c, 'tagline', t);
    for (let i = 0; i < 3; i++) adapter.apply(c.id);
    expect(decoCount()).toBe(2);
    a.remove();
    t.remove();
    adapter.apply(c.id);
    expect(a.isConnected).toBe(true);
    expect(t.parentElement).toBe(own(c.source, 'commentMeta'));
    expect(decoCount()).toBe(2);
  });

  it('falls back to the meta slot when the comment has no author link', () => {
    const { deco, adapter } = setup();
    const comments = commentsOf();
    const c = comments[0]!;
    c.source.querySelector('[slot="commentMeta"] a')!.remove();
    adapter.track(batch({ comments }));
    const a = span('A');
    deco.decorate(c, 'author', a);
    expect(a.parentElement).toBe(own(c.source, 'commentMeta'));
    expect(a.hasAttribute('slot')).toBe(false);
  });
});

describe('nested comments keep their own decorations', () => {
  it('a parent decoration lands on the parent’s author, not a child’s', () => {
    mount(nestedThreadHtml());
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    const parent = comments.find((c) => c.id === 't1_c0')!;
    const child = comments.find((c) => c.id === 't1_c1')!;
    const pa = span('parent');
    const ca = span('child');
    deco.decorate(parent, 'author', pa);
    deco.decorate(child, 'author', ca);

    expect(pa.previousElementSibling?.getAttribute('href')).toBe(`/user/${parent.author}/`);
    expect(pa.closest('shreddit-comment')).toBe(parent.source);
    expect(ca.previousElementSibling?.getAttribute('href')).toBe(`/user/${child.author}/`);
    expect(ca.closest('shreddit-comment')).toBe(child.source);
  });

  it('a parent’s slot node lands in the parent’s own meta line, not a reply’s', () => {
    mount(nestedThreadHtml());
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    const parent = comments.find((c) => c.id === 't1_c0')!;
    const t = span('tag');
    deco.decorate(parent, 'tagline', t);
    expect(t.parentElement).toBe(own(parent.source, 'commentMeta'));
    expect(t.closest('shreddit-comment')).toBe(parent.source);
  });
});

describe('profile comments', () => {
  it('skips placements whose anchors do not exist', () => {
    mount(profileCommentsHtml());
    const { deco, adapter } = setup();
    const pc = parseProfileComment(document.querySelector('shreddit-profile-comment')!)!;
    adapter.track(batch({ profileComments: [pc] }));
    const a = span('A');
    const t = span('T');
    deco.decorate(pc, 'author', a);
    deco.decorate(pc, 'tagline', t);
    expect(a.isConnected).toBe(false);
    expect(t.isConnected).toBe(false);
  });

  it('uses the meta slot when Reddit rendered one', () => {
    mount(profileCommentsHtml());
    const el = document.querySelector('shreddit-profile-comment')!;
    el.insertAdjacentHTML('afterbegin', '<div slot="commentMeta"></div>');
    const { deco, adapter } = setup();
    const pc = parseProfileComment(el)!;
    adapter.track(batch({ profileComments: [pc] }));
    const t = span('T');
    deco.decorate(pc, 'tagline', t);
    expect(t.parentElement).toBe(own(el, 'commentMeta'));
    expect(t.hasAttribute('slot')).toBe(false);
  });
});

describe('collapseBody', () => {
  it('collapses only the comment’s own body, never a nested child’s', () => {
    for (const childrenFirst of [false, true]) {
      mount(nestedThreadHtml(undefined, childrenFirst));
      const { deco, adapter } = setup();
      const comments = commentsOf();
      adapter.track(batch({ comments }));
      const parent = comments.find((c) => c.id === 't1_c0')!;
      const child = comments.find((c) => c.id === 't1_c1')!;
      deco.collapseBody(parent, true);

      const bodies = (c: Comment) =>
        [...c.source.querySelectorAll<HTMLElement>('[slot="comment"]')].filter(
          (b) => b.closest('shreddit-comment') === c.source,
        );
      expect(bodies(parent)).toHaveLength(1);
      expect(bodies(parent)[0]!.hasAttribute('data-rescue-collapsed')).toBe(true);
      expect(bodies(parent)[0]!.style.display).toBe('none');
      expect(bodies(child)[0]!.hasAttribute('data-rescue-collapsed')).toBe(false);
      expect(bodies(child)[0]!.style.display).toBe('');
      expect(parent.source.hasAttribute('data-rescue-hidden')).toBe(false);

      deco.collapseBody(parent, false);
      expect(bodies(parent)[0]!.hasAttribute('data-rescue-collapsed')).toBe(false);
      expect(bodies(parent)[0]!.style.display).toBe('');
    }
  });

  it('survives a re-track of the same comments', () => {
    mount(nestedThreadHtml());
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    deco.collapseBody(comments[0]!, true);
    adapter.track(batch({ comments: commentsOf() }));
    expect(document.querySelectorAll('[data-rescue-collapsed]')).toHaveLength(1);
  });
});

describe('markAuthor', () => {
  it('adds and withdraws a class on the item’s own author link, idempotently', () => {
    mount(nestedThreadHtml());
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    const parent = comments.find((c) => c.id === 't1_c0')!;
    const child = comments.find((c) => c.id === 't1_c1')!;
    const own = (c: Comment) =>
      [...c.source.querySelectorAll('a[href^="/user/"]')].find(
        (l) => l.closest('shreddit-comment') === c.source,
      )!;
    deco.markAuthor(parent, 'mark-a');
    deco.markAuthor(parent, 'mark-a');
    adapter.apply(parent.id);
    expect(own(parent).classList.contains('mark-a')).toBe(true);
    expect(own(child).classList.contains('mark-a')).toBe(false);
    expect(document.querySelectorAll('.mark-a')).toHaveLength(1);
    deco.unmarkAuthor(parent, 'mark-a');
    expect(own(parent).classList.contains('mark-a')).toBe(false);
  });

  it('re-applies after Reddit re-renders the author link, and marks a post’s author', () => {
    mount(listingHtml());
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    deco.markAuthor(post, 'mark-b');
    const bar = post.source.querySelector('[slot="credit-bar"]')!;
    const markup = bar.innerHTML;
    bar.innerHTML = markup;
    adapter.apply(post.id);
    expect(post.source.querySelector('[slot="authorName"] a')!.classList.contains('mark-b')).toBe(
      true,
    );
  });
});

describe('hide reasons', () => {
  it('unhide(reason) withdraws only that reason', () => {
    mount(listingHtml());
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    const article = post.source.closest('article')!;
    deco.hide(post, 'keyword');
    deco.hide(post, 'ignored user');
    deco.unhide(post, 'ignored user');
    expect(article.getAttribute('data-rescue-hidden')).toBe('keyword');
    deco.unhide(post);
    expect(article.hasAttribute('data-rescue-hidden')).toBe(false);
  });
});

describe('a page Reddit detaches and later restores (back/forward)', () => {
  it('replaces the old nodes even when they were detached at the moment of clear()', () => {
    mount(nestedThreadHtml());
    const { deco, adapter } = setup();
    const comments = commentsOf();
    adapter.track(batch({ comments }));
    const c = comments.find((x) => x.id === 't1_c0')!;
    const marked = (text: string) => {
      const s = span(text);
      s.className = 'rescue-test-kind deco-test';
      return s;
    };
    deco.decorate(c, 'author', marked('first'));
    expect(decoCount()).toBe(1);

    // Route change away: Reddit detaches the thread, then REScue's decorations are cleared.
    const thread = c.source.closest('shreddit-comment-tree') ?? c.source.parentElement!;
    const parent = thread.parentElement!;
    const next = thread.nextSibling;
    thread.remove();
    deco.clear();
    // Back: Reddit re-attaches the same elements, REScue's old node inside, and the pipeline
    // delivers the comments again; the module decorates with a fresh node.
    parent.insertBefore(thread, next);
    adapter.reset();
    adapter.track(batch({ comments: commentsOf() }));
    const again = commentsOf().find((x) => x.id === 't1_c0')!;
    deco.decorate(again, 'author', marked('second'));
    expect(decoCount()).toBe(1);
    expect(document.querySelector('.deco-test')!.textContent).toBe('second');
  });
});
describe('Reddit swaps a lazily rendered credit bar after REScue decorated it', () => {
  it('puts the decorations back without anyone calling apply', async () => {
    mount(listingHtml());
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    const bar = post.source.querySelector('[slot="credit-bar"]')!;
    const pristine = bar.cloneNode(true);
    const a = span('A');
    const t = span('T');
    deco.decorate(post, 'author', a);
    deco.decorate(post, 'tagline', t);
    expect(decoCount(post.source)).toBe(2);

    // The placeholder is replaced by the real credit bar; REScue's nodes go with it.
    bar.replaceWith(pristine);
    expect(decoCount(post.source)).toBe(0);
    await new Promise((r) => setTimeout(r, 60));
    expect(a.isConnected).toBe(true);
    expect(t.isConnected).toBe(true);
    expect(decoCount(post.source)).toBe(2);
    adapter.stop();
  });

  it('does not loop on its own placements', async () => {
    mount(listingHtml());
    const { deco, adapter } = setup();
    const post = postOf('t3_text1');
    adapter.track(batch({ posts: [post] }));
    let moves = 0;
    const probe = new MutationObserver((r) => (moves += r.length));
    probe.observe(document, { childList: true, subtree: true });
    deco.decorate(post, 'tagline', span('T'));
    await new Promise((r) => setTimeout(r, 80));
    probe.disconnect();
    expect(moves).toBeLessThan(4);
    adapter.stop();
  });
});