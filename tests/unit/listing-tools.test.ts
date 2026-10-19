import { afterEach, describe, expect, it } from 'vitest';
import { autoHide } from '../../src/modules/listings/autoHide';
import {
  subredditTagger,
  tagTable,
  validateTagRow,
} from '../../src/modules/listings/subredditTagger';
import { commentSortBy, sortFor } from '../../src/modules/comments/commentSortBy';
import { readComments } from '../../src/modules/comments/readComments';
import { closeReadStore } from '../../src/modules/comments/readTracking';
import { sortByColumn } from '../../src/modules/comments/tableSort';
import { tableTools } from '../../src/modules/comments/tableTools';
import { withThreadParams } from '../../src/modules/comments/threadUrl';
import { listingHtml, mount, nestedThreadHtml, threadComments } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

afterEach(() => {
  closeReadStore();
  document.body.innerHTML = '';
});

const TABLE =
  '<table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody>' +
  '<tr><td>bravo</td><td>10</td></tr><tr><td>alpha</td><td>9</td></tr><tr><td>charlie</td><td>100</td></tr>' +
  '</tbody></table>';
const names = (t: Element) =>
  [...t.querySelectorAll('tbody tr')].map((r) => r.firstElementChild?.textContent);
const route = { kind: 'thread', path: '/r/Layoffs/comments/text1/x', postId: 't3_text1' };

describe('tableSort', () => {
  it('sorts ascending by text, then reverses, and numbers sort as numbers', () => {
    document.body.innerHTML = TABLE;
    const table = document.querySelector('table')!;
    const [name, score] = [...table.querySelectorAll('th')];
    expect(sortByColumn(name!)).toBe(true);
    expect(names(table)).toEqual(['alpha', 'bravo', 'charlie']);
    expect(name!.classList.contains('sort-asc')).toBe(true);
    sortByColumn(name!);
    expect(names(table)).toEqual(['charlie', 'bravo', 'alpha']);
    expect(name!.classList.contains('sort-desc')).toBe(true);
    sortByColumn(score!);
    expect(names(table)).toEqual(['alpha', 'bravo', 'charlie']); // 9, 10, 100 (not "10" < "9")
    expect(name!.classList.contains('sort-desc')).toBe(false); // earlier column's marker cleared
    expect(score!.classList.contains('sort-asc')).toBe(true);
  });
});

describe('tableTools', () => {
  const thread = () =>
    mount(
      nestedThreadHtml(threadComments().map((c, i) => (i === 1 ? { ...c, bodyHtml: TABLE } : c))),
    );

  it('sorts a table inside a comment body when its heading is clicked', async () => {
    thread();
    document.body.insertAdjacentHTML('beforeend', `<div id="outside">${TABLE}</div>`);
    const m = await bootModules([tableTools], { route });
    m.flush();
    const table = document.querySelector('shreddit-comment[thingid="t1_c1"] table')!;
    expect(table.classList.contains('rescue-sortable')).toBe(true);
    table.querySelector('th')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(names(table)).toEqual(['alpha', 'bravo', 'charlie']);

    const outside = document.querySelector('#outside table')!;
    outside.querySelector('th')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(names(outside)).toEqual(['bravo', 'alpha', 'charlie']); // not an item body: untouched
    m.dispose();
    table.querySelector('th')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(names(table)).toEqual(['alpha', 'bravo', 'charlie']); // listener gone, nothing re-sorted
  });
});

describe('thread URL defaults', () => {
  const link = '/r/aww/comments/image1/dog/';

  it('adds a missing sort and leaves a chosen one alone', () => {
    expect(withThreadParams(link, { sort: 'top' })).toBe(`${link}?sort=top`);
    expect(withThreadParams(`${link}?sort=new`, { sort: 'top' })).toBeNull();
    expect(withThreadParams(`${link}?x=1#c`, { sort: 'old' })).toBe(`${link}?x=1&sort=old#c`);
    expect(withThreadParams(`https://www.reddit.com${link}`, { sort: 'qa' })).toBe(
      `https://www.reddit.com${link}?sort=qa`,
    );
  });

  it('only touches reddit thread links', () => {
    expect(withThreadParams('https://example.com/comments/x', { sort: 'top' })).toBeNull();
    expect(withThreadParams('/r/aww/', { sort: 'top' })).toBeNull();
    expect(withThreadParams(link, {})).toBeNull();
  });

  it('picks a per-subreddit sort over the default', () => {
    const rows = [{ subreddit: 'r/Aww', sort: 'new' }];
    expect(sortFor(link, 'top', rows)).toBe('new');
    expect(sortFor('/r/other/comments/a/b/', 'top', rows)).toBe('top');
    expect(sortFor(link, '', [])).toBe('');
    expect(sortFor(link, 'bogus', [])).toBe('');
  });
});

describe('commentSortBy on a listing', () => {
  const title = (id: string) =>
    document.querySelector<HTMLAnchorElement>(`shreddit-post#${id} a[slot="title"]`)!;
  const listing = { kind: 'all', path: '/r/all' };

  it('rewrites post thread links up front, and again just before use', async () => {
    mount(listingHtml());
    const m = await bootModules([commentSortBy], {
      route: listing,
      options: { commentSortBy: { defaultSort: 'top' } },
    });
    m.flush();
    expect(title('t3_image1').getAttribute('href')).toBe('/r/aww/comments/image1/dog/?sort=top');
    title('t3_link1').setAttribute('href', '/r/nottheonion/comments/link1/nasa/?sort=new');
    title('t3_link1').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(title('t3_link1').getAttribute('href')).toBe(
      '/r/nottheonion/comments/link1/nasa/?sort=new',
    );
    // Reddit re-rendered the link: it is fixed on the way to being used.
    title('t3_image1').setAttribute('href', '/r/aww/comments/image1/dog/');
    title('t3_image1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(title('t3_image1').getAttribute('href')).toBe('/r/aww/comments/image1/dog/?sort=top');
    m.dispose();
    title('t3_image1').setAttribute('href', '/r/aww/comments/image1/dog/');
    title('t3_image1').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(title('t3_image1').getAttribute('href')).toBe('/r/aww/comments/image1/dog/');
  });

  it('changes nothing with the defaults, and honours a per-subreddit sort', async () => {
    mount(listingHtml());
    const plain = await bootModules([commentSortBy], { route: listing });
    plain.flush();
    expect(title('t3_image1').getAttribute('href')).toBe('/r/aww/comments/image1/dog/');
    plain.dispose();

    const m = await bootModules([commentSortBy], {
      route: listing,
      options: { commentSortBy: { perSubreddit: [{ subreddit: 'aww', sort: 'new' }] } },
    });
    m.pipeline.reset();
    m.flush();
    expect(title('t3_image1').getAttribute('href')).toBe('/r/aww/comments/image1/dog/?sort=new');
    expect(title('t3_link1').getAttribute('href')).toBe('/r/nottheonion/comments/link1/nasa/');
    m.dispose();
  });
});

describe('autoHide', () => {
  const stored = { read: { t3_text1: { lastVisit: Date.now() - 1000, commentCountAtVisit: 3 } } };
  const wrapper = (id: string) => document.querySelector(`article:has(shreddit-post#${id})`)!;

  it('is off by default and needs readComments', () => {
    expect(autoHide.enabledByDefault).toBe(false);
    expect(autoHide.dependsOn).toEqual(['readComments']);
  });

  it('hides feed posts that were opened before, with a notice that can show them again', async () => {
    mount(listingHtml());
    const m = await bootModules([readComments, autoHide], {
      route: { kind: 'all', path: '/r/all' },
      stored,
    });
    m.flush();
    expect(wrapper('t3_text1').getAttribute('data-rescue-hidden')).toBe('autoHide');
    expect(wrapper('t3_link1').hasAttribute('data-rescue-hidden')).toBe(false);
    const banner = document.querySelector('.rescue-autohide-banner')!;
    expect(banner.textContent).toContain('1 read post hidden');
    banner.querySelector<HTMLButtonElement>('button')!.click();
    expect((wrapper('t3_text1') as HTMLElement).style.display).not.toBe('none');
    m.dispose();
  });

  it('leaves profile pages and threads alone', async () => {
    mount(listingHtml());
    const m = await bootModules([readComments, autoHide], {
      route: { kind: 'profile', path: '/user/x', username: 'x' },
      stored,
    });
    m.flush();
    await tick();
    expect(document.querySelector('[data-rescue-hidden]')).toBeNull();
    m.dispose();
  });
});

describe('subredditTagger', () => {
  const rows = [
    { subreddit: 'r/Aww', tag: 'cute', color: '#ffcc00' },
    { subreddit: 'nottheonion', tag: '<img src=x onerror=alert(1)>', color: '' },
    { subreddit: 'bad name', tag: 'x', color: '' },
    { subreddit: 'pics', tag: '', color: '' },
  ];

  it('validates rows at input but lets incomplete rows through', () => {
    expect(validateTagRow({ subreddit: '', tag: '', color: '' })).toBeNull();
    expect(validateTagRow({ subreddit: 'aww', tag: '', color: '#e0e0e0' })).toBeNull();
    expect(validateTagRow({ subreddit: 'r/aww', tag: 'cute', color: '' })).toBeNull();
    expect(validateTagRow({ subreddit: 'bad name', tag: 'x' })).toMatch(/subreddit/i);
    expect(validateTagRow({ subreddit: 'aww', tag: 'x'.repeat(41) })).toMatch(/40/);
    expect(validateTagRow({ subreddit: 'aww', tag: 'x', color: 'red' })).toMatch(/#rrggbb/);
  });

  it('keeps only complete rows, keyed by lower-cased subreddit', () => {
    expect([...tagTable(rows).keys()]).toEqual(['aww', 'nottheonion']);
  });

  it('adds the tag after the time on listing posts of that subreddit only, as text', async () => {
    mount(listingHtml());
    const m = await bootModules([subredditTagger], {
      route: { kind: 'all', path: '/r/all' },
      options: { subredditTagger: { tags: rows } },
    });
    m.flush();
    const tags = [...document.querySelectorAll<HTMLElement>('.rescue-sub-tag')];
    expect(tags.map((t) => t.dataset.sub)).toEqual(['nottheonion', 'aww']);
    const aww = document.querySelector<HTMLElement>('shreddit-post#t3_image1 .rescue-sub-tag')!;
    expect(aww.textContent).toBe('cute');
    expect(aww.style.backgroundColor).toMatch(/#ffcc00|rgb\(255, 204, 0\)/i);
    expect(
      document.querySelector('shreddit-post#t3_image1 faceplate-timeago')!.nextElementSibling,
    ).toBe(aww);
    expect(document.querySelector('.rescue-sub-tag img')).toBeNull();
    m.dispose();
  });

  it('does nothing inside a thread or without tags', async () => {
    mount(listingHtml());
    const m = await bootModules([subredditTagger], {
      route,
      options: { subredditTagger: { tags: rows } },
    });
    m.flush();
    expect(document.querySelector('.rescue-sub-tag')).toBeNull();
    m.dispose();
  });
});
