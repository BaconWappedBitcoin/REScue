/**
 * Fixture pages for the Old Reddit look's browser specs (old-skin.spec.ts, old-skin-extras.spec.ts):
 * the live shapes of a feed post (open shadow root with vote buttons, a share button and the overflow
 * menu) and of a comment (action row with vote buttons, a reply button and a menu), recording every
 * press in window.__clicks.
 */
import { htmlDoc } from './harness';
import { POSTS, postHtml, nestedCommentsHtml, threadComments } from '../fixtures/pages';

export const LISTING = 'https://www.reddit.com/r/science/';
export const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
/** The same thread, where the reader (me_the_reader) wrote some of the comments. */
export const MY_THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/?mine=1';
export const PROFILE = 'https://www.reddit.com/user/alice/';

export const SORT = `<div class="sortrow"><shreddit-sort-dropdown sort-event="feed-sort-change"><div slot="dropdown-items">
  <data value="BEST"><li rpl-selected=""><a href="/r/science/best/">Best</a></li></data>
  <data value="HOT"><li><a href="/r/science/hot/">Hot</a></li></data>
  <data value="NEW"><li><a href="/r/science/new/">New</a></li></data>
  <data value="TOP"><li><a href="/r/science/top/">Top</a></li></data></div></shreddit-sort-dropdown></div>`;

// Reddit's feed posts: a full-card link over the post, and an open shadow root holding the action
// row (vote buttons that flip aria-pressed, a comments link, a share button) and, in the light DOM,
// the overflow menu with the Save / Hide / Report rows. A post given `data-novote` has no vote
// buttons at all (a shape REScue does not know).
export const POST_SCRIPT = `<script>
window.__clicks = [];
for (const p of document.querySelectorAll('shreddit-post')) {
  const id = p.getAttribute('id');
  p.style.position = 'relative';
  const link = document.createElement('a');
  link.slot = 'full-post-link';
  link.href = p.getAttribute('permalink') || '#';
  link.style.cssText = 'position:absolute;inset:0;display:block';
  link.addEventListener('click', (e) => { e.preventDefault(); window.__clicks.push(id + ':open'); });
  p.prepend(link);
  const sr = p.attachShadow({ mode: 'open' });
  const votes = p.hasAttribute('data-novote') ? '' : '<button id="vote" upvote aria-pressed="false">Upvote</button><button downvote aria-pressed="false">Downvote</button>';
  sr.innerHTML = '<slot name="full-post-link"></slot><slot name="credit-bar"></slot><slot name="title"></slot><slot name="post-media-container"></slot><slot></slot><div id="row">' + votes + '<button part="share-button">Share</button></div>';
  for (const b of sr.querySelectorAll('button[upvote], button[downvote]')) {
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      window.__clicks.push(id + ':vote-' + (b.hasAttribute('upvote') ? 'up' : 'down') + '-' + (on ? 'on' : 'off'));
      setTimeout(() => {
        for (const o of sr.querySelectorAll('button[upvote], button[downvote]')) o.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', String(on));
      }, 60);
    });
  }
  sr.querySelector('[part=share-button]').addEventListener('click', () => window.__clicks.push(id + ':share'));
  const menu = document.createElement('shreddit-post-overflow-menu');
  const root = menu.attachShadow({ mode: 'open' });
  root.innerHTML = '<button id="overflow-trigger" aria-expanded="false">…</button><ul class="items" hidden><li role="presentation">Save</li><li role="presentation">Hide</li><li role="presentation">Report</li></ul>';
  const trigger = root.querySelector('#overflow-trigger');
  const items = root.querySelector('.items');
  trigger.addEventListener('click', () => { items.hidden = !items.hidden; trigger.setAttribute('aria-expanded', String(!items.hidden)); });
  for (const item of root.querySelectorAll('li')) {
    item.addEventListener('click', () => {
      const text = item.textContent;
      window.__clicks.push(id + ':item-' + text);
      items.hidden = true; trigger.setAttribute('aria-expanded', 'false');
      if (text === 'Save') item.textContent = 'Unsave';
      else if (text === 'Hide') (p.closest('article') || p).remove();
    });
  }
  const credit = p.querySelector('[slot=credit-bar]');
  (credit || p).appendChild(menu);
}
</script>`;

export const COMMENT_SCRIPT = `<script>
window.__clicks = [];
for (const c of document.querySelectorAll('shreddit-comment')) {
  const id = c.getAttribute('thingid');
  const row = document.createElement('shreddit-comment-action-row');
  row.setAttribute('slot', 'actionRow'); row.setAttribute('comment-id', id); row.setAttribute('score', c.getAttribute('score'));
  const root = row.attachShadow({ mode: 'open' });
  root.innerHTML = '<button upvote aria-pressed="false">up</button><button downvote aria-pressed="false">down</button>';
  for (const b of root.querySelectorAll('button')) b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    window.__clicks.push(id + ':vote-' + (b.hasAttribute('upvote') ? 'up' : 'down') + '-' + (on ? 'on' : 'off'));
    setTimeout(() => { for (const o of root.querySelectorAll('button')) o.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', String(on)); }, 60);
  });
  const tracker = document.createElement('faceplate-tracker');
  tracker.setAttribute('slot', 'comment-reply');
  const reply = document.createElement('button'); reply.textContent = 'Reply';
  reply.addEventListener('click', () => { window.__clicks.push(id + ':reply'); const box = document.createElement('textarea'); box.id = 'reply-box-' + id; c.appendChild(box); });
  tracker.appendChild(reply); row.appendChild(tracker);
  const menu = document.createElement('shreddit-overflow-menu'); menu.setAttribute('slot', 'overflow'); if (c.getAttribute('author') === 'me_the_reader') menu.setAttribute('is-send-replies', '');
  const mr = menu.attachShadow({ mode: 'open' });
  mr.innerHTML = '<button id="overflow-trigger" aria-expanded="false">…</button><div class="items" hidden><div role="menuitem">Save</div><div role="menuitem">Report</div>' + (c.getAttribute('author') === 'me_the_reader' ? '<div role="menuitem">Disable inbox replies</div><div role="menuitem">Delete</div>' : '') + '</div>';
  const t = mr.querySelector('#overflow-trigger'); const items = mr.querySelector('.items');
  t.addEventListener('click', () => { items.hidden = !items.hidden; t.setAttribute('aria-expanded', String(!items.hidden)); });
  for (const it of mr.querySelectorAll('[role=menuitem]')) it.addEventListener('click', () => { window.__clicks.push(id + ':item-' + it.textContent); items.hidden = true; t.setAttribute('aria-expanded', 'false'); if (it.textContent === 'Save') it.textContent = 'Unsave'; else if (it.textContent === 'Disable inbox replies') { it.textContent = 'Enable inbox replies'; menu.removeAttribute('is-send-replies'); } else if (it.textContent === 'Enable inbox replies') { it.textContent = 'Disable inbox replies'; menu.setAttribute('is-send-replies', ''); } });
  row.appendChild(menu);
  const grid = document.createElement('div'); grid.className = 'grid';
  const box = document.createElement('div'); box.appendChild(row); grid.appendChild(box);
  (c.querySelector(':scope > details') || c).appendChild(grid);
}
</script>`;

export const shell = (inner: string, signedIn: boolean) =>
  `<shreddit-app${signedIn ? ' user-logged-in="true"' : ''}>${signedIn ? '<after-login-toast-dispatcher username="me_the_reader"></after-login-toast-dispatcher>' : ''}<div class="grid-container"><div id="left-sidebar-container">nav</div><div id="subgrid-container">` +
  `<div class="main-container"><main id="main-content">${inner}</main>` +
  `<div id="right-sidebar-container"><aside>sidebar</aside></div></div></div></div></shreddit-app>`;

export const listing = (signedIn = true, extra = '') =>
  htmlDoc(
    shell(
      `${SORT}<shreddit-feed>${POSTS.slice(0, 3).map(postHtml).join('')}</shreddit-feed>`,
      signedIn,
    ) +
      extra +
      POST_SCRIPT,
    '<style>shreddit-post { display: block }</style>',
  );
export const thread = (signedIn = true, author?: string) =>
  htmlDoc(
    shell(
      postHtml(POSTS[0]!).replace(/^<article>|<\/article>$/g, '') +
        nestedCommentsHtml(threadComments(author), false, true),
      signedIn,
    ) +
      POST_SCRIPT +
      COMMENT_SCRIPT,
  );
export const profile = () =>
  htmlDoc(
    `<shreddit-app><main id="main-content"><shreddit-profile-comment></shreddit-profile-comment></main></shreddit-app>`,
  );
