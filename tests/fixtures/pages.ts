/**
 * Synthetic Reddit pages built from live-captured structure (constitution Principle VI).
 * Shapes follow Sheddit test/fixtures.js (GPL-3.0, kookaburrabarrel, commit cff40d7) and
 * REScue research R2-R5. Fixtures intentionally contain Reddit tag names; they are test data.
 */

export interface FixturePost {
  id: string;
  type?: string;
  title?: string;
  permalink?: string;
  contentHref?: string;
  score?: string;
  comments?: string;
  domain?: string;
  author?: string;
  sub?: string;
  nsfw?: boolean | 'false';
  spoiler?: boolean;
  body?: string;
  imgs?: Array<string | { src?: string; srcset?: string; lazy?: string }>;
  /** Give the author the live user hover card (data-id and an empty div[slot=content]). */
  hoverCard?: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const POSTS: FixturePost[] = [
  {
    id: 't3_text1',
    type: 'text',
    title: 'Got laid off',
    permalink: '/r/Layoffs/comments/text1/got_laid_off/',
    domain: 'self.Layoffs',
    score: '8479',
    comments: '1115',
    author: 'rockpaperblr',
    sub: 'Layoffs',
    body: '<p>Body text of the post.</p>',
  },
  {
    id: 't3_link1',
    type: 'link',
    title: 'NASA confirms gravity',
    permalink: '/r/nottheonion/comments/link1/nasa/',
    contentHref: 'https://example.co.uk/nasa',
    domain: 'example.co.uk',
    score: '1867',
    comments: '182',
    author: 'kleudorian',
    sub: 'nottheonion',
    imgs: ['external-preview.redd.it/nasa-thumb.jpg'],
  },
  {
    id: 't3_image1',
    type: 'image',
    title: 'A very good dog',
    permalink: '/r/aww/comments/image1/dog/',
    contentHref: 'https://i.redd.it/gooddog.jpg',
    domain: 'i.redd.it',
    score: '43110',
    comments: '902',
    author: 'dogperson',
    sub: 'aww',
    imgs: [
      {
        src: 'https://i.redd.it/gooddog.jpg',
        srcset:
          'https://preview.redd.it/gooddog-320.jpg 320w, https://preview.redd.it/gooddog-1080.jpg 1080w',
      },
    ],
  },
  {
    id: 't3_gallery1',
    type: 'gallery',
    title: 'Bubble Boy',
    permalink: '/r/interesting/comments/gallery1/bubble/',
    contentHref: 'https://www.reddit.com/gallery/gallery1',
    domain: 'reddit.com',
    score: '12247',
    comments: '1270',
    author: 'Wonderfulhumanss',
    sub: 'interesting',
    imgs: [
      'styles.redditmedia.com/t5_x/communityIcon.png',
      { lazy: 'https://preview.redd.it/bubble-1-1280.jpg' },
      { lazy: 'https://preview.redd.it/bubble-2-1280.jpg' },
      { lazy: 'https://preview.redd.it/bubble-1-1280.jpg?width=640' },
    ],
  },
  {
    id: 't3_nsfw1',
    type: 'image',
    title: 'Graphic footage',
    permalink: '/r/war/comments/nsfw1/footage/',
    contentHref: 'https://i.redd.it/front.jpg',
    domain: 'i.redd.it',
    score: '1204',
    comments: '88',
    author: 'reporter',
    sub: 'war',
    nsfw: true,
    imgs: ['i.redd.it/front.jpg'],
  },
  {
    id: 't3_safeflag1',
    type: 'link',
    title: 'Explicitly not adult',
    permalink: '/r/test/comments/safeflag1/post/',
    contentHref: 'https://example.com/safe',
    domain: 'example.com',
    score: '12',
    comments: '1',
    author: 'someone',
    sub: 'test',
    nsfw: 'false',
  },
  {
    id: 't3_weird1',
    type: 'multi_media',
    title: 'Unknown type',
    permalink: '/r/pics/comments/weird1/x/',
    domain: 'reddit.com',
    score: '5',
    comments: '0',
    author: 'mixer',
    sub: 'pics',
  },
];

function imgHtml(i: NonNullable<FixturePost['imgs']>[number]): string {
  if (typeof i === 'string') return `<img src="${/^https?:/.test(i) ? i : 'https://' + i}">`;
  const a = [
    i.src ? `src="${i.src}"` : '',
    i.srcset ? `srcset="${i.srcset}"` : '',
    i.lazy ? `data-lazy-src="${i.lazy}"` : '',
  ];
  return `<img ${a.filter(Boolean).join(' ')}>`;
}

export function postHtml(p: FixturePost): string {
  const attrs: Array<[string, string | undefined]> = [
    ['id', p.id],
    ['post-title', p.title],
    ['permalink', p.permalink],
    ['content-href', p.contentHref],
    ['post-type', p.type],
    ['score', p.score],
    ['upvote-ratio', '0.97'],
    ['comment-count', p.comments],
    ['created-timestamp', '2026-10-15T10:00:00.000Z'],
    ['domain', p.domain],
    ['author', p.author],
    ['subreddit-name', p.sub],
    ['subreddit-prefixed-name', p.sub ? `r/${p.sub}` : undefined],
  ];
  if (p.nsfw === true) attrs.push(['nsfw', '']);
  if (p.nsfw === 'false') attrs.push(['nsfw', 'false']);
  if (p.spoiler) attrs.push(['spoiler', '']);
  const a = attrs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(' ');
  const body = p.body ? `<div slot="text-body">${p.body}</div>` : '';
  const imgs = (p.imgs ?? []).map(imgHtml).join('');
  // Hover-card partial inside each post: the decoy Sheddit's paginator once drove (R3).
  const hover = p.author
    ? `<faceplate-partial loading="programmatic" src="/svc/shreddit/user-hover-card/${p.author}"></faceplate-partial>`
    : '';
  // Structure verified live 2026-10-15 (listing): the credit bar is a two-group row — left: the
  // authorName wrapper (> hovercard > tracker > link), a separator, the relative time; right: the
  // overflow menu.
  const credit = p.author
    ? `<span slot="credit-bar"><span class="rescue-fx-left">${authorNameHtml(p.author, p.hoverCard)}<span>•</span><faceplate-timeago><time>1h</time></faceplate-timeago></span><span class="rescue-fx-right"><button>…</button></span></span>`
    : '';
  const title = `<a slot="title" href="${esc(p.permalink ?? '')}">${esc(p.title ?? '')}</a>`;
  return `<article><shreddit-post ${a}>${credit}${title}${imgs}${body}${hover}</shreddit-post></article>`;
}

/**
 * Reddit's author name wrapper: span[slot=authorName] > hovercard > tracker > a[/user/]. With
 * `card`, the hovercard is the live user card (research R20): data-id plus a div[slot=content].
 */
export function authorNameHtml(author: string, card = false): string {
  const attr = card ? ' data-id="user-hover-card"' : '';
  const content = card ? '<div slot="content"></div>' : '';
  return `<span slot="authorName"><faceplate-hovercard${attr}><faceplate-tracker><a href="/user/${esc(author)}/">u/${esc(author)}</a></faceplate-tracker>${content}</faceplate-hovercard></span>`;
}

/** Reddit's header icon strip (research R20): Create sits in its entry-point wrapper between icons. */
export function headerStripHtml(): string {
  return '<reddit-header-large><div id="header-icons"><a href="/chat/">chat</a><create-post-entry-point-wrapper><a id="create-post" href="/submit">Create</a></create-post-entry-point-wrapper><a href="/notifications/">inbox</a></div></reddit-header-large>';
}

export function listingHtml(posts: FixturePost[] = POSTS, opts: { empty?: boolean } = {}): string {
  const items = opts.empty
    ? '<div><h1 data-testid="no-content">There aren\'t any posts yet</h1></div>'
    : posts.map(postHtml).join('<hr>') +
      '<shreddit-ad-post id="t3_ad1" post-title="Buy things"></shreddit-ad-post>';
  return `<shreddit-app><div id="main-content"><shreddit-feed>${items}
    <faceplate-partial loading="programmatic" src="/svc/shreddit/community-hover-card/aww"></faceplate-partial>
    <faceplate-partial slot="load-after" id="partial-more-posts-x" loading="programmatic" src="/svc/shreddit/community-more-posts/hot/?after=t3_x"></faceplate-partial>
  </shreddit-feed></div></shreddit-app>`;
}

export interface FixtureSearchItem {
  id: string;
  title: string;
  sub?: string;
  /** The author only exists in the tracking-context JSON; no link is rendered (live 2026-10-15). */
  author?: string;
  nsfw?: boolean;
  spoiler?: boolean;
  votes?: number;
  comments?: number;
  ts?: string;
  /** `search-post-with-content-preview` (default) or `search-post-unit`. */
  variant?: 'preview' | 'unit';
  /** Only some live items carry `data-testid="search-sdui-post"` / `data-thingid`. */
  thingAttrs?: boolean;
}

export const SEARCH_ITEMS: FixtureSearchItem[] = [
  {
    id: 't3_srch1',
    title: 'Creatine and sleep',
    sub: 'science',
    author: 'sci_fan',
    votes: 18689,
    comments: 1646,
    thingAttrs: true,
  },
  {
    id: 't3_srch2',
    title: 'Rust borrow checker tips',
    sub: 'rust',
    author: 'ferris_fan',
    votes: 420,
    comments: 37,
    variant: 'unit',
  },
  {
    id: 't3_srch3',
    title: 'Spoiler heavy discussion',
    sub: 'movies',
    author: 'film_buff',
    spoiler: true,
    votes: 12,
    comments: 3,
  },
];

/**
 * One search result, shaped like the live capture (contracts: `search.*`): an outer tracker with
 * view-events and the JSON context, a nested click tracker around the overlay title link, and the
 * credit row / title text / counter row inside `sdui-post-unit`.
 */
export function searchItemHtml(it: FixtureSearchItem, index = 0): string {
  const sub = it.sub ?? 'science';
  const ctx = JSON.stringify({
    action_info: { position: index, relative_position: index },
    post: { id: it.id, nsfw: !!it.nsfw, spoiler: !!it.spoiler, title: it.title },
    ...(it.author ? { profile: { id: 't2_fake', name: it.author } } : {}),
    subreddit: { id: 't5_fake', name: sub, nsfw: false, quarantined: false },
  });
  const slug = it.id.slice(3);
  const href = `/r/${sub}/comments/${slug}/slug/`;
  const thing = it.thingAttrs ? ` data-testid="search-sdui-post" data-thingid="${esc(it.id)}"` : '';
  const cls = it.variant === 'unit' ? 'search-post-unit' : 'search-post-with-content-preview';
  return `<search-telemetry-tracker view-events="search/view/post" data-faceplate-tracking-context="${esc(ctx)}"${thing}>
  <div data-testid="${cls}" class="flex relative">
    <search-telemetry-tracker click-events="search/click/post" data-faceplate-tracking-context="${esc(ctx)}"><h2><a data-testid="post-title" href="${href}" class="absolute inset-0" aria-label="${esc(it.title)}">${esc(it.title)}</a></h2></search-telemetry-tracker>
    <div data-testid="sdui-post-unit">
      <div><div class="post-credit-row flex items-center relative overflow-hidden whitespace-nowrap max-w-full">
        <span class="flex items-center"><faceplate-hovercard><search-telemetry-tracker click-events="search/click/subreddit" data-faceplate-tracking-context="${esc(ctx)}"><a href="/r/${sub}/">r/${sub}</a></search-telemetry-tracker></faceplate-hovercard><span>·</span><faceplate-timeago ts="${it.ts ?? '2026-10-13T10:08:12.362000+0000'}"><time>3d ago</time></faceplate-timeago></span>
      </div></div>
      <a data-testid="post-title-text" href="${href}">${esc(it.title)}</a>
      <div data-testid="search-counter-row"><span><faceplate-number number="${it.votes ?? 5}">5</faceplate-number> votes</span><span>·</span><span><faceplate-number number="${it.comments ?? 2}">2</faceplate-number> comments</span></div>
    </div>
  </div>
</search-telemetry-tracker>`;
}

/** A search results page: each result is a search-telemetry-tracker, not a shreddit-post. */
export function searchPageHtml(items: FixtureSearchItem[] = SEARCH_ITEMS): string {
  return `<shreddit-app><div id="main-content"><div id="search-results">${items.map(searchItemHtml).join('')}</div></div></shreddit-app>`;
}

export interface FixtureComment {
  id: string;
  depth: number;
  author: string;
  body: string;
  score?: number;
  /** Adds Reddit's presence attribute (is-mod-distinguished / is-admin-distinguished). */
  distinguished?: 'moderator' | 'admin';
  /** ISO timestamp for the created attribute (default 2026-10-15T11:00Z). */
  created?: string;
  /** Raw body markup instead of a paragraph of `body` (tables, images, links). */
  bodyHtml?: string;
  /** Adds Reddit's `collapsed` attribute (candidate; see contracts comment.collapsed). */
  collapsed?: boolean;
  /** Emits Reddit's light-DOM thread line (default true; set false to omit it). */
  threadline?: boolean;
}

/** Depth sequence from Sheddit's fixtures: exercises siblings, nesting and returns to root. */
export const COMMENT_DEPTHS = [0, 1, 2, 1, 0, 1, 0, 0, 1, 2, 3, 0];

export function threadComments(postAuthor = 'rockpaperblr'): FixtureComment[] {
  return COMMENT_DEPTHS.map((depth, i) => ({
    id: `t1_c${i}`,
    depth,
    author: i % 4 === 1 ? postAuthor : `user${i}`,
    body: `comment ${i} body`,
    score: 10 + i,
  }));
}

function commentOpen(c: FixtureComment, pos: number, withDetails = false): string {
  const collapsed = c.collapsed ? ' collapsed=""' : '';
  return `<shreddit-comment thingid="${c.id}" postid="t3_text1" author="${c.author}" score="${c.score ?? 1}" created="${c.created ?? '2026-10-15T11:00:00.000Z'}"${c.distinguished === 'moderator' ? ' is-mod-distinguished=""' : c.distinguished === 'admin' ? ' is-admin-distinguished=""' : ''}${collapsed} depth="${c.depth}" comment-position="${pos}" permalink="/r/Layoffs/comments/text1/got_laid_off/${c.id.slice(3)}/"><div slot="commentMeta">${authorNameHtml(c.author)}<time>1h</time></div>`.replace(
    /(<div slot="commentMeta">.*<\/div>)$/,
    withDetails ? '<details open><summary>$1</summary>' : '$1',
  );
}

/** Reddit's light-DOM thread line inside a comment (commentQuickCollapse restyles it). */
export const threadlineHtml = (c: FixtureComment): string =>
  c.threadline === false ? '' : '<div class="threadline-strip"></div>';

/**
 * A comment's own action row, with an OPEN shadow root holding vote buttons (the live shape,
 * research R20). `aria-pressed` is the current vote; the row's `vote-state` attribute mirrors the
 * live site's staleness by only being set when asked.
 */
export function addCommentRow(
  host: Element,
  opts: { score?: number; hidden?: boolean; upvoted?: boolean; downvoted?: boolean } = {},
): Element {
  const id = host.getAttribute('thingid') ?? '';
  const row = document.createElement('shreddit-comment-action-row');
  row.setAttribute('slot', 'actionRow');
  row.setAttribute('comment-id', id);
  if (opts.score !== undefined) row.setAttribute('score', String(opts.score));
  if (opts.hidden) row.setAttribute('is-score-hidden', '');
  row.setAttribute('vote-state', opts.upvoted ? 'up' : opts.downvoted ? 'down' : 'none');
  const root = row.attachShadow({ mode: 'open' });
  root.innerHTML =
    `<button upvote aria-pressed="${opts.upvoted ? 'true' : 'false'}"></button>` +
    `<button downvote aria-pressed="${opts.downvoted ? 'true' : 'false'}"></button>`;
  host.appendChild(row);
  return row;
}

/**
 * A comment's own “N more replies” control (contracts: comment.moreReplies, candidate). Appended
 * into the comment's subtree; clicking it sets `data-clicked` so a test can see the click.
 */
export function addMoreReplies(host: Element, n = 3): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'rescue-fx-more-replies';
  b.textContent = `${n} more repl${n === 1 ? 'y' : 'ies'}`;
  b.addEventListener('click', () => b.setAttribute('data-clicked', ''));
  host.appendChild(b);
  return b;
}

/** Flat siblings, threading carried only by `depth` (as observed 2026-08-12). */
export function flatThreadHtml(comments = threadComments()): string {
  const body = comments
    .map(
      (c, i) =>
        `${commentOpen(c, i)}${threadlineHtml(c)}<div slot="comment">${c.bodyHtml ?? `<p>${c.body}</p>`}</div></shreddit-comment>`,
    )
    .join('');
  return `<shreddit-app>${postHtml(POSTS[0]!)}<shreddit-comment-tree>${body}
    <faceplate-partial loading="programmatic" src="/svc/shreddit/more-comments/t3_text1"></faceplate-partial>
  </shreddit-comment-tree></shreddit-app>`;
}

/**
 * DOM-nested comments (as observed 2026-08-14). `childrenFirst` puts the child container BEFORE
 * the body, which is the ordering that breaks an unscoped body lookup.
 */
/**
 * With `withDetails`, each comment has Reddit's own collapse element (verified live 2026-10-15): a
 * light-DOM <details open> whose <summary> holds the meta line and which wraps the body and the
 * replies.
 */
export function nestedThreadHtml(
  comments = threadComments(),
  childrenFirst = false,
  withDetails = false,
): string {
  return `<shreddit-app>${postHtml(POSTS[0]!)}<shreddit-comment-tree>${nestedCommentsHtml(comments, childrenFirst, withDetails)}</shreddit-comment-tree></shreddit-app>`;
}

/** Just the nested comment elements (what Reddit appends into the comment tree). */
export function nestedCommentsHtml(
  comments: FixtureComment[],
  childrenFirst = false,
  withDetails = false,
): string {
  let i = 0;
  const render = (depth: number): string => {
    let out = '';
    while (i < comments.length && comments[i]!.depth === depth) {
      const c = comments[i]!;
      const pos = i++;
      const children = `<details open><div class="grid"><div class="col-span-2 grid">${render(depth + 1)}</div></div></details>`;
      const body = `<div slot="comment">${c.bodyHtml ?? `<p>${c.body}</p>`}</div>`;
      out +=
        commentOpen(c, pos, withDetails) +
        threadlineHtml(c) +
        (childrenFirst ? children + body : body + children) +
        (withDetails ? '</details>' : '') +
        '</shreddit-comment>';
    }
    return out;
  };
  return render(0);
}

export function profileCommentsHtml(owner = 'someone'): string {
  return `<shreddit-app><shreddit-profile-comment comment-id="t1_p1" href="/r/aww/comments/image1/dog/p1/?context=3">
      <a href="/r/aww/">r/aww</a><a href="/r/aww/comments/image1/dog/">A very good dog</a>
      <time datetime="2026-10-14T09:00:00.000Z"></time><div slot="comment"><p>Nice dog, by ${owner}</p></div>
    </shreddit-profile-comment></shreddit-app>`;
}

export function sessionHtml(signedIn: boolean, username = 'me_the_reader'): string {
  return signedIn
    ? `<shreddit-app user-logged-in="true"><after-login-toast-dispatcher username="${username}"></after-login-toast-dispatcher><reddit-header-large></reddit-header-large></shreddit-app>`
    : `<shreddit-app><reddit-header-large><a href="/login/">Log in</a></reddit-header-large></shreddit-app>`;
}

/**
 * Promoted slots as seen live 2026-10-16 (research R21): `shreddit-ad-post` in the feed and
 * `shreddit-comments-page-ad` above a thread's comments, each with an "Ad" label span in its
 * credit bar; `shreddit-sidebar-ad` in the right sidebar. Given a block box so they can be measured.
 */
export function adPostHtml(id = 't3_ad1', title = 'Buy things'): string {
  return `<shreddit-ad-post id="${id}" promoted ad-type="display" style="display:block;height:80px"><div slot="credit-bar"><a href="/user/advertiser/"><span>Ad</span></a></div><a href="https://ads.example.com/x">${esc(title)}</a></shreddit-ad-post>`;
}

export function commentsPageAdHtml(): string {
  return '<shreddit-comments-page-ad id="t3_adc1" ad-type="display" style="display:block;height:70px"><div slot="credit-bar"><span>Ad</span></div><a href="https://ads.example.com/c">Sponsored thing</a></shreddit-comments-page-ad>';
}

export function sidebarAdHtml(): string {
  return '<div id="right-sidebar-container"><shreddit-sidebar-ad id="t3_adsb1" style="display:block;height:60px"><a href="https://ads.example.com/s">Sidebar thing</a></shreddit-sidebar-ad></div>';
}

/** An ordinary-looking `shreddit-post` whose credit bar carries the promoted word. */
export function labelledPostHtml(p: FixturePost, word = 'Promoted'): string {
  return postHtml(p).replace(
    '<span slot="credit-bar">',
    `<span slot="credit-bar"><span class="promoted-word">${word}</span>`,
  );
}

export function mount(html: string, doc: Document = document): Document {
  doc.body.innerHTML = html;
  return doc;
}

/**
 * Media inside comment bodies, as observed live 2026-10-16: every picture, GIF and video is a
 * `figure.rte-media` in the light-DOM `div[slot=comment]`. A GIF is a looping `shreddit-player`
 * with the `gif` attribute; a video is a `shreddit-player` in `div.rte-video-placeholder`. The real
 * player keeps its `<video>` in a shadow root; the fixture uses a light-DOM `<video>` so tests can
 * see whether it is playing.
 */
export const COMMENT_IMAGE_FIGURE =
  '<figure class="rte-media"><a href="https://preview.redd.it/pic.png" target="_blank"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Comment Image" width="40" height="40"></a></figure>';
export const COMMENT_GIF_FIGURE =
  '<figure class="rte-media"><div><a href="https://external-preview.redd.it/x.gif" target="_blank"><div style="width:40px;height:40px"><shreddit-player gif="" autoplay=""><video class="fixture-comment-video" width="40" height="40" muted loop></video></shreddit-player></div></a></div></figure>';
export const COMMENT_VIDEO_FIGURE =
  '<figure class="rte-media"><div class="rte-video-placeholder"><shreddit-player player-type="comment_player"><video class="fixture-comment-video" width="40" height="40" muted loop></video></shreddit-player></div></figure>';

/** Comments whose bodies carry media: image, GIF, video, none, two figures, and a nested reply. */
export function commentMediaComments(): FixtureComment[] {
  const body = (text: string, ...figures: string[]): string =>
    `<div class="py-0"><p>${text}</p>${figures.join('')}</div>`;
  const c = (id: string, depth: number, bodyHtml?: string): FixtureComment => ({
    id,
    depth,
    author: 'someone',
    body: 'just words',
    ...(bodyHtml ? { bodyHtml } : {}),
  });
  return [
    c('t1_img', 0, body('has a picture', COMMENT_IMAGE_FIGURE)),
    c('t1_gif', 0, body('has a gif', COMMENT_GIF_FIGURE)),
    c('t1_vid', 0, body('has a video', COMMENT_VIDEO_FIGURE)),
    c('t1_none', 0),
    c('t1_two', 0, body('two things', COMMENT_IMAGE_FIGURE, COMMENT_VIDEO_FIGURE)),
    c('t1_reply', 1, body('nested pic', COMMENT_IMAGE_FIGURE)),
  ];
}

// --- overflow menus (save / hide; this lane) -----------------------------------------------------
// The menus cannot be built from an HTML string (they need an open shadow root), so they are made
// with the DOM here. Shapes follow the live capture 2026-10-16: a post has a light-DOM
// `shreddit-post-overflow-menu`; a comment has `shreddit-overflow-menu[slot=overflow]` inside its
// action row. Rows are found by TEXT, so the menu flips "Save"<->"Unsave" and "Hide"<->"Unhide" in
// place when clicked, and a post's "Hide" removes its <article> (Reddit's own behaviour).

export interface MenuFixtureOptions {
  /** Called with each row's text right after it is clicked (before its own effect). */
  onItem?: (text: string) => void;
}

/** Open/close the menu and wire every row, so tests exercise the real click-by-text path. */
function wireMenu(
  root: ShadowRoot,
  opts: MenuFixtureOptions,
  onRow: (row: Element, text: string) => void,
): void {
  const trigger = root.querySelector<HTMLElement>('#overflow-trigger')!;
  const items = root.querySelector<HTMLElement>('.items')!;
  trigger.addEventListener('click', () => {
    const open = items.hidden;
    items.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  });
  for (const row of root.querySelectorAll('[role="presentation"], [role="menuitem"]')) {
    row.addEventListener('click', () => {
      const text = (row.textContent ?? '').trim();
      items.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      opts.onItem?.(text);
      onRow(row, text);
    });
  }
}

/** Attach Reddit's post overflow menu to a `shreddit-post`; returns the menu element. */
export function addPostOverflowMenu(
  post: Element,
  opts: MenuFixtureOptions = {},
): HTMLElement {
  const menu = document.createElement('shreddit-post-overflow-menu');
  const root = menu.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<button id="overflow-trigger" aria-expanded="false">…</button>' +
    '<ul class="items" hidden>' +
    '<li role="presentation">Follow post</li>' +
    '<li role="presentation">Save</li>' +
    '<li role="presentation">Hide</li>' +
    '<li role="presentation">Report</li>' +
    '<div role="menuitem">Get Clean Link</div>' +
    '</ul>';
  wireMenu(root, opts, (row, text) => {
    if (/^save$/i.test(text)) row.textContent = 'Unsave';
    else if (/^unsave$/i.test(text)) row.textContent = 'Save';
    else if (/^hide$/i.test(text)) {
      const article = post.closest('article');
      (article ?? post).remove();
    } else if (/^unhide$/i.test(text)) row.textContent = 'Hide';
  });
  post.appendChild(menu);
  return menu;
}

/** Attach a comment's overflow menu to its action row; returns the menu element. */
export function addCommentOverflowMenu(
  row: Element,
  opts: MenuFixtureOptions & { editable?: boolean } = {},
): HTMLElement {
  const menu = document.createElement('shreddit-overflow-menu');
  menu.setAttribute('slot', 'overflow');
  if (opts.editable) {
    menu.setAttribute('editable-comment', '');
    menu.setAttribute('is-comment-author', '');
  }
  const root = menu.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<button id="overflow-trigger" aria-expanded="false">…</button>' +
    '<div class="items" hidden>' +
    '<div role="menuitem">Follow comment</div>' +
    '<div role="menuitem">Save</div>' +
    '<div role="menuitem">Report</div>' +
    (opts.editable ? '<div role="menuitem">Edit comment</div>' : '') +
    '</div>';
  wireMenu(root, opts, (el, text) => {
    if (/^save$/i.test(text)) el.textContent = 'Unsave';
    else if (/^unsave$/i.test(text)) el.textContent = 'Save';
  });
  row.appendChild(menu);
  return menu;
}
