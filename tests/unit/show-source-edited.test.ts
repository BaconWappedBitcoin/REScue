// The "source" word (showSource: raw Markdown from the thread JSON, /comments/<post>.json and
// /comments/<post>/_/<comment>.json) and edited timestamps (editedAtOf, and old Reddit's "*" /
// "(last edited …)" in the Old Reddit look).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RedditJsonClient, jsonFor, type JsonResponse } from '../../src/core/redditJson';
import { defaultProfile } from '../../src/core/settings';
import type { ModuleContext } from '../../src/core/types';
import { editedAtOf, editedText } from '../../src/model/edited';
import { MODULES } from '../../src/modules';
import { localDate, showLastEdited } from '../../src/modules/appearance/localDate';
import { CommentView } from '../../src/modules/appearance/oldSkin/comment';
import {
  REFUSED_TEXT,
  SIGNED_OUT_TEXT,
  SOURCE_POPUP_ID,
  closeSourcePopup,
  loadSource,
  openSourcePopup,
  showSource,
  showSourcePopup,
  sourceEnabled,
} from '../../src/modules/comments/showSource';

const reply = (body: unknown, status = 200): JsonResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(body),
});

/** A client that answers every request with `answer` and records the addresses asked for. */
function client(answer: () => JsonResponse) {
  const urls: string[] = [];
  const c = new RedditJsonClient({
    fetchJson: async (url) => {
      urls.push(url);
      return answer();
    },
    sleep: async () => {},
  });
  const notices = { show: vi.fn() } as unknown as ModuleContext['notices'];
  return { urls, get: jsonFor(notices, 'showSource', c) };
}

const postListing = (data: Record<string, unknown>) => ({
  kind: 'Listing',
  data: { children: [{ kind: 't3', data: { num_comments: 2, title: 'T', ...data } }] },
});
const commentListing = (...children: Array<Record<string, unknown>>) => ({
  kind: 'Listing',
  data: { children: children.map((data) => ({ kind: 't1', data })) },
});

/** The live shape of /comments/p1/_/abc.json (2026-10-21): the post, then that one comment. */
const COMMENT_THREAD = [
  postListing({ name: 't3_p1', selftext: '' }),
  commentListing({
    name: 't1_abc',
    body: 'Fish & chips <b>\n\n> quoted',
    score: 4,
    edited: 1760667356,
  }),
];
/** The live shape of /comments/p1.json?limit=1&depth=0: the post, and an empty comment listing. */
const POST_THREAD = [
  postListing({ name: 't3_p1', selftext: '# Hi\n*x*', edited: false }),
  commentListing(),
];

afterEach(() => {
  closeSourcePopup();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('thread JSON for comments and text posts', () => {
  it('asks for one comment’s thread with raw_json=1 and reads its raw Markdown and edit time', async () => {
    const { urls, get } = client(() => reply(COMMENT_THREAD));
    const res = await get('comments', { id: 't3_p1', comment: 't1_abc', limit: 1, depth: 1 });
    expect(urls).toEqual(['/comments/p1/_/abc.json?raw_json=1&limit=1&depth=1']);
    expect(res).toMatchObject({
      ok: true,
      data: {
        post: { id: 't3_p1', selftext: '' },
        comments: [{ id: 't1_abc', body: 'Fish & chips <b>\n\n> quoted', edited: 1760667356000 }],
      },
    });
  });

  it('reads a post’s selftext (raw Markdown) from the post-only form', async () => {
    const { urls, get } = client(() => reply(POST_THREAD));
    const res = await get('comments', { id: 't3_p1', limit: 1, depth: 0 });
    expect(urls).toEqual(['/comments/p1.json?raw_json=1&limit=1&depth=0']);
    expect(res).toMatchObject({ ok: true, data: { post: { id: 't3_p1', selftext: '# Hi\n*x*' } } });
    expect('edited' in (res as { data: { post: object } }).data.post).toBe(false);
  });

  it('rejects a comment without a name, and comment ids that are not ids', async () => {
    const { get, urls } = client(() =>
      reply([postListing({ name: 't3_p1' }), commentListing({ body: 'x' })]),
    );
    expect(await get('comments', { id: 'p1', comment: 'abc' })).toMatchObject({
      ok: false,
      reason: 'shape',
    });
    expect(await get('comments', { id: 'p1', comment: '../x' })).toMatchObject({
      reason: 'params',
    });
    expect(urls).toHaveLength(1);
  });
});

describe('loadSource', () => {
  it('accepts Reddit’s newer, longer comment ids (live 2026-10-21: 13 characters)', async () => {
    const id = 't1_19rfviy114w00';
    const thread = [postListing({ name: 't3_p1' }), commentListing({ name: id, body: 'long id' })];
    const { urls, get } = client(() => reply(thread));
    expect(await loadSource(id, get, true, 't3_p1')).toEqual({ ok: true, text: 'long id' });
    expect(urls).toEqual(['/comments/p1/_/19rfviy114w00.json?raw_json=1&limit=1&depth=1']);
  });

  it('returns the comment or post text, never asking /api/info.json', async () => {
    const c = client(() => reply(COMMENT_THREAD));
    expect(await loadSource('t1_abc', c.get, true, 't3_p1')).toEqual({
      ok: true,
      text: 'Fish & chips <b>\n\n> quoted',
    });
    const p = client(() => reply(POST_THREAD));
    expect(await loadSource('t3_p1', p.get, true)).toEqual({ ok: true, text: '# Hi\n*x*' });
    expect(p.urls).toEqual(['/comments/p1.json?raw_json=1&limit=1&depth=0']);
    expect([...c.urls, ...p.urls].some((u) => u.includes('/api/info.json'))).toBe(false);
  });

  it('fails clearly, asking nothing, for a comment whose post is not known', async () => {
    const c = client(() => reply(COMMENT_THREAD));
    const res = await loadSource('t1_abc', c.get, true, null);
    expect(res).toEqual({
      ok: false,
      message: 'REScue could not load the source: REScue does not know this comment’s post.',
    });
    expect(c.urls).toEqual([]);
  });

  it('asks nothing when signed out; a 403 while signed in says Reddit refused, not "sign in"', async () => {
    const out = client(() => reply(COMMENT_THREAD));
    expect(await loadSource('t1_abc', out.get, false, 't3_p1')).toEqual({
      ok: false,
      message: `REScue: ${SIGNED_OUT_TEXT}`,
    });
    expect(out.urls).toEqual([]);
    const refused = await loadSource('t1_abc', client(() => reply({}, 403)).get, true, 't3_p1');
    expect(refused).toEqual({ ok: false, message: `REScue: ${REFUSED_TEXT}` });
    expect(REFUSED_TEXT).toBe('Reddit refused to share this item’s text (HTTP 403).');
  });

  it('says why it failed otherwise', async () => {
    const r500 = await loadSource('t1_abc', client(() => reply({}, 500)).get, true, 't3_p1');
    expect(r500).toEqual({
      ok: false,
      message: 'REScue could not load the source: Reddit answered 500.',
    });
    const missing = await loadSource(
      't1_zzz',
      client(() => reply(COMMENT_THREAD)).get,
      true,
      't3_p1',
    );
    expect(missing.ok).toBe(false);
    const otherPost = await loadSource('t3_p2', client(() => reply(POST_THREAD)).get, true);
    expect(otherPost.ok).toBe(false);
    expect(await loadSource('nope', client(() => reply(COMMENT_THREAD)).get, true)).toMatchObject({
      ok: false,
    });
  });
});

describe('the source popup', () => {
  it('shows the text read-only, copies it, and closes on Escape; one at a time', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    showSourcePopup('first');
    const root = showSourcePopup('a & b\n*c*');
    expect(document.querySelectorAll(`#${SOURCE_POPUP_ID}`)).toHaveLength(1);
    const box = root.querySelector<HTMLTextAreaElement>('textarea.rescue-source-text')!;
    expect(box.value).toBe('a & b\n*c*');
    expect(box.readOnly).toBe(true);
    const copy = root.querySelector<HTMLButtonElement>('.rescue-source-copy')!;
    copy.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('a & b\n*c*');
    expect(copy.textContent).toBe('copied');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById(SOURCE_POPUP_ID)).toBeNull();
  });

  it('closes with its close button', () => {
    const root = showSourcePopup('x');
    root.querySelector<HTMLButtonElement>('.rescue-source-close')!.click();
    expect(document.getElementById(SOURCE_POPUP_ID)).toBeNull();
  });

  it('keeps Tab inside while open and gives the focus back to the word that opened it', () => {
    const word = document.createElement('button');
    document.body.append(word);
    word.focus();
    const root = showSourcePopup('x');
    const box = root.querySelector<HTMLTextAreaElement>('textarea')!;
    const close = root.querySelector<HTMLButtonElement>('.rescue-source-close')!;
    expect(document.activeElement).toBe(box);
    const tab = (shiftKey = false) => {
      const e = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement!.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(tab(true)).toBe(true); // Shift+Tab from the first control goes round to the last
    expect(document.activeElement).toBe(close);
    expect(tab()).toBe(true); // Tab from the last goes round to the first, never to the page
    expect(document.activeElement).toBe(box);
    expect(tab()).toBe(false); // in between, the browser moves it as usual
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.activeElement).toBe(word);

    showSourcePopup('y', word);
    root.ownerDocument.querySelector<HTMLButtonElement>('.rescue-source-close')!.click();
    expect(document.activeElement).toBe(word);
    word.remove();
  });

  it('shows a notice instead of a popup when signed out', async () => {
    const show = vi.fn();
    const ctx = { notices: { show }, session: { signedIn: false } } as unknown as ModuleContext;
    await openSourcePopup('t1_abc', ctx);
    expect(document.getElementById(SOURCE_POPUP_ID)).toBeNull();
    expect(show).toHaveBeenCalledWith(`REScue: ${SIGNED_OUT_TEXT}`, expect.anything());
  });
});

describe('the module', () => {
  it('is registered, off by default, with no options', () => {
    expect(MODULES).toContain(showSource);
    expect(showSource.enabledByDefault).toBe(false);
    expect(showSource.category).toBe('comments');
    expect(showSource.title).toBe('Show source');
  });
});

// --- edited timestamps -----------------------------------------------------------------------

const EDITED_TS = '2026-10-17T02:15:56.528Z';
const editedSpan = (ts: string) =>
  `<span class="text-neutral-content-weak text-12"> Edited <faceplate-timeago ts="${ts}" format="narrow"><time datetime="${ts}">5d ago</time></faceplate-timeago></span>`;

function commentHtml(id: string, opts: { edited?: string; replies?: string } = {}): string {
  return (
    `<shreddit-comment thingid="${id}" postid="t3_text1" author="alice" score="196" depth="0" created="2026-10-21T10:00:00.000Z" permalink="/r/x/comments/text1/t/${id.slice(3)}/">` +
    `<details open><summary><div slot="commentMeta"><div class="author">alice</div>` +
    `<faceplate-timeago ts="2026-10-21T10:00:00.000Z"><time>2h ago</time></faceplate-timeago>` +
    `${opts.edited ? editedSpan(opts.edited) : ''}</div></summary>` +
    `<div class="grid"><div slot="comment"><p>hi</p></div>${opts.replies ?? ''}</div></details>` +
    `</shreddit-comment>`
  );
}

function mountComment(html: string): Element {
  document.body.innerHTML = html;
  return document.querySelector('shreddit-comment')!;
}

describe('editedAtOf', () => {
  it('reads the comment’s own Edited marker', () => {
    const c = mountComment(commentHtml('t1_a', { edited: EDITED_TS }));
    expect(editedAtOf(c)?.toISOString()).toBe(EDITED_TS);
  });

  it('is null without the marker, and for a span that only mentions Edited elsewhere', () => {
    expect(editedAtOf(mountComment(commentHtml('t1_a')))).toBeNull();
    const odd = mountComment(commentHtml('t1_a'));
    odd
      .querySelector('[slot="commentMeta"]')!
      .insertAdjacentHTML(
        'beforeend',
        `<span>Not Edited <faceplate-timeago ts="${EDITED_TS}"></faceplate-timeago></span>`,
      );
    expect(editedAtOf(odd)).toBeNull();
  });

  it('never takes an edited reply’s marker for its parent', () => {
    const parent = mountComment(
      commentHtml('t1_a', { replies: commentHtml('t1_b', { edited: EDITED_TS }) }),
    );
    expect(editedAtOf(parent)).toBeNull();
    expect(
      editedAtOf(parent.querySelector('shreddit-comment[thingid="t1_b"]')!)?.toISOString(),
    ).toBe(EDITED_TS);
  });
});

describe('the Old Reddit look', () => {
  const now = Date.parse('2026-10-22T02:15:56.528Z');

  it('shows old Reddit’s "*" with the edited time on hover, or spells it out', () => {
    const at = new Date(EDITED_TS);
    expect(editedText(at, false, now)).toEqual({ text: '*', title: 'last edited 5 days ago' });
    expect(editedText(at, true, now)).toEqual({
      text: ' (last edited 5 days ago)',
      title: 'last edited 5 days ago',
    });
    expect(editedText(null, true, now)).toBeNull();
  });

  /** A context with just what CommentView reads, and the given modules switched on. */
  function ctxWith(on: string[], localDateOptions: Record<string, boolean> = {}): ModuleContext {
    const profile = defaultProfile();
    for (const id of on) profile.modules[id] = { enabled: true };
    if (profile.modules.localDate) profile.modules.localDate.options = localDateOptions;
    return {
      session: { signedIn: true, username: 'someone' },
      settings: { definitions: () => MODULES, profile: () => profile },
      notices: { show: vi.fn() },
      actions: {},
    } as unknown as ModuleContext;
  }

  it('reads showLastEditedTimestamp only while localDate is on', () => {
    expect(localDate.options.showLastEditedTimestamp.default).toBe(true);
    expect(showLastEdited(ctxWith([]))).toBe(false);
    expect(showLastEdited(ctxWith(['localDate']))).toBe(true);
    expect(showLastEdited(ctxWith(['localDate'], { showLastEditedTimestamp: false }))).toBe(false);
  });

  // The score half ("196 points") comes from Reddit's vote pill, which this fixture does not draw.
  it('draws "… 2 hours ago*" and "source" only while showSource is on', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-21T12:00:00.000Z'), toFake: ['Date'] });
    try {
      const host = mountComment(commentHtml('t1_a', { edited: EDITED_TS }));
      const off = CommentView.mount(host, ctxWith([]));
      expect(off).not.toBeNull();
      const pts = host.querySelector('.rescue-opts')!;
      expect(pts.textContent).toMatch(/ 2 hours ago\*$/);
      expect(pts.querySelector('.rescue-oedited')!.getAttribute('title')).toBe(
        'last edited 4 days ago',
      );
      const sourceItem = [...host.querySelectorAll('.rescue-ocl button')].find(
        (b) => b.textContent === 'source',
      )!.parentElement!;
      expect(sourceItem.hidden).toBe(true);
      off!.dispose();

      const on = CommentView.mount(host, ctxWith(['showSource', 'localDate']));
      expect(host.querySelector('.rescue-opts')!.textContent).toMatch(
        / 2 hours ago \(last edited 4 days ago\)$/,
      );
      const item = [...host.querySelectorAll('.rescue-ocl button')].find(
        (b) => b.textContent === 'source',
      )!.parentElement!;
      expect(item.hidden).toBe(false);
      expect(sourceEnabled(ctxWith(['showSource']))).toBe(true);
      on!.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no "*" on a comment that was not edited', () => {
    const host = mountComment(commentHtml('t1_a'));
    CommentView.mount(host, ctxWith([]));
    const mark = host.querySelector<HTMLElement>('.rescue-oedited')!;
    expect(mark.hidden).toBe(true);
  });
});
