import { describe, expect, it, beforeEach } from 'vitest';
import {
  POSTS,
  listingHtml,
  flatThreadHtml,
  nestedThreadHtml,
  threadComments,
  profileCommentsHtml,
  sessionHtml,
  mount,
  postHtml,
} from '../fixtures/pages';
import { parsePost, PostDeduper } from '../../src/model/post';
import { parseComments, buildTree } from '../../src/model/comment';
import { parseProfileComment } from '../../src/model/profile-comment';
import { readSession } from '../../src/model/session';
import { isNativeCollapsed, ownDetails } from '../../src/model/access';
import { ContractTally } from '../../src/model/tally';

const posts = () => [...document.querySelectorAll('shreddit-post')];

describe('Post model', () => {
  beforeEach(() => mount(listingHtml()));

  it('parses every fixture post and ignores ads', () => {
    const parsed = posts()
      .map((el) => parsePost(el))
      .filter(Boolean);
    expect(parsed).toHaveLength(POSTS.length);
    expect(parsed.map((p) => p!.id)).not.toContain('t3_ad1');
  });

  it('maps fields per data-model.md', () => {
    const p = parsePost(posts()[0]!)!;
    expect(p).toMatchObject({
      id: 't3_text1',
      title: 'Got laid off',
      permalink: '/r/Layoffs/comments/text1/got_laid_off/',
      type: 'text',
      subreddit: 'Layoffs',
      author: 'rockpaperblr',
      score: 8479,
      upvoteRatio: 0.97,
      commentCount: 1115,
      nsfw: false,
    });
    expect(p.created).toBeInstanceOf(Date);
  });

  it('maps an unknown post-type to "other"', () => {
    const weird = posts().find((e) => e.id === 't3_weird1')!;
    expect(parsePost(weird)!.type).toBe('other');
  });

  it('reads nsfw as presence, honouring an explicit "false"', () => {
    const byId = (id: string) => parsePost(posts().find((e) => e.id === id)!)!;
    expect(byId('t3_nsfw1').nsfw).toBe(true);
    expect(byId('t3_safeflag1').nsfw).toBe(false);
  });

  it.each(['id', 'post-title', 'permalink'])(
    'skips a post missing required "%s" and tallies it',
    (attr) => {
      mount(postHtml(POSTS[1]!));
      const el = document.querySelector('shreddit-post')!;
      el.removeAttribute(attr);
      const tally = new ContractTally();
      expect(parsePost(el, tally)).toBeNull();
      expect(tally.misses('post.attrs')).toBe(1);
    },
  );

  it('dedupes posts by id across batches', () => {
    const d = new PostDeduper();
    const first = posts()
      .map((el) => parsePost(el)!)
      .filter((p) => d.accept(p));
    const again = posts()
      .map((el) => parsePost(el)!)
      .filter((p) => d.accept(p));
    expect(first).toHaveLength(POSTS.length);
    expect(again).toHaveLength(0);
  });

  it('accepts a re-rendered element for a known id once the old one has left the page', () => {
    const d = new PostDeduper();
    const el = posts()[0]!;
    expect(d.accept(parsePost(el)!)).toBe(true);
    const copy = el.cloneNode(true) as Element;
    el.after(copy);
    expect(d.accept(parsePost(copy)!)).toBe(false); // the same post twice in the feed
    el.remove(); // Reddit threw the old element away
    expect(d.accept(parsePost(copy)!)).toBe(true); // the new one is a post with no decorations yet
    expect(d.accept(parsePost(copy)!)).toBe(false);
  });
});

describe('Comment model', () => {
  const expectedParents = () => {
    // Depth-stack reference implementation over the fixture sequence.
    const out: Array<string | null> = [];
    const stack: string[] = [];
    for (const c of threadComments()) {
      stack.length = c.depth;
      out.push(c.depth === 0 ? null : stack[c.depth - 1]!);
      stack[c.depth] = c.id;
    }
    return out;
  };

  it.each([
    ['flat', () => flatThreadHtml()],
    ['nested, body first', () => nestedThreadHtml(threadComments(), false)],
    ['nested, children first', () => nestedThreadHtml(threadComments(), true)],
  ])('builds the same tree from depth (%s)', (_name, html) => {
    mount(html());
    const comments = parseComments(document, 'rockpaperblr');
    expect(comments.map((c) => c.id)).toEqual(threadComments().map((c) => c.id));
    expect(comments.map((c) => c.parentId)).toEqual(expectedParents());
    const roots = buildTree(comments);
    expect(roots).toHaveLength(threadComments().filter((c) => c.depth === 0).length);
  });

  it('scopes each body to its own comment even when children come first', () => {
    mount(nestedThreadHtml(threadComments(), true));
    const comments = parseComments(document, 'rockpaperblr');
    comments.forEach((c, i) => expect(c.bodyHtml).toContain(`comment ${i} body`));
    comments.forEach((c, i) => expect(c.bodyHtml).not.toContain(`comment ${i + 1} body`));
  });

  it('derives isOp from the post author', () => {
    mount(flatThreadHtml());
    const comments = parseComments(document, 'rockpaperblr');
    const ops = comments.filter((c) => c.isOp).map((c) => c.author);
    expect(ops.length).toBeGreaterThan(0);
    expect(new Set(ops)).toEqual(new Set(['rockpaperblr']));
  });

  it('reads moderator distinction from the presence attribute (verified live), and ignores look-alikes', () => {
    mount(flatThreadHtml());
    const [first, second] = [...document.querySelectorAll('shreddit-comment')];
    first!.setAttribute('is-mod-distinguished', '');
    second!.setAttribute('distinguished', 'moderator'); // not Reddit's attribute
    const parsed = parseComments(document, 'x');
    expect(parsed[0]!.distinguished).toBe('moderator');
    expect(parsed[1]!.distinguished).toBeNull();
    expect(parsed[2]!.distinguished).toBeNull();
  });
});

describe('Profile comment and session', () => {
  it('parses a profile comment with its subreddit context', () => {
    mount(profileCommentsHtml());
    const pc = parseProfileComment(document.querySelector('shreddit-profile-comment')!)!;
    expect(pc).toMatchObject({
      id: 't1_p1',
      permalink: '/r/aww/comments/image1/dog/p1/',
      subreddit: 'aww',
      postTitle: 'A very good dog',
    });
  });

  it('reads the signed-in username from the toast dispatcher', () => {
    mount(sessionHtml(true, 'reader1'));
    expect(readSession(document)).toEqual({ signedIn: true, username: 'reader1' });
  });

  it('reports signed out', () => {
    mount(sessionHtml(false));
    expect(readSession(document)).toEqual({ signedIn: false, username: null });
  });
});

describe('A comment’s own collapse element', () => {
  it('is never a reply’s: a comment with no collapse element reports none', () => {
    mount(
      `<shreddit-comment thingid="t1_a" depth="0"><div slot="comment"><p>no collapse here</p></div>` +
        `<shreddit-comment thingid="t1_b" depth="1"><details open><summary><span>meta</span></summary>` +
        `<div slot="comment"><p>reply</p></div></details></shreddit-comment></shreddit-comment>`,
    );
    const parent = document.querySelector('shreddit-comment[thingid="t1_a"]')!;
    const reply = document.querySelector('shreddit-comment[thingid="t1_b"]')!;
    expect(ownDetails(parent)).toBeNull();
    expect(isNativeCollapsed(parent)).toBeNull();
    expect(ownDetails(reply)).not.toBeNull();
  });
});
