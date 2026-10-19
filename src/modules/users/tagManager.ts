/**
 * The tagged-users manager (RES dashboard "My user tags", lib/modules/userTagger.js
 * addDashboardFunctionality, GPL-3.0): a REScue overlay listing every tag with search, sort, edit
 * and delete. It owns no storage; the host loads, edits and removes. User text is written with
 * textContent only.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { buildTagChip } from './tagChip';
import { formatVotes, tagKey, type UserTag, type UserTags } from './tagStore';

export type TagSort = 'name' | 'tag' | 'votes' | 'updated';

export interface ManagerHost {
  /** Fresh tags from storage. */
  load(): Promise<UserTags>;
  /** Open the tag editor for this user (the host refreshes the manager after a change). */
  edit(username: string, anchor: Element): void;
  remove(username: string): Promise<void>;
  /** Import Reddit's blocked users as ignored (needs a signed-in reader). */
  importBlocked?(): void;
  signedIn?: boolean;
}

/** Tags matching `query` (user name, tag text or link, case-insensitive), in `sort` order. */
export function listTags(tags: UserTags, query: string, sort: TagSort): UserTag[] {
  const q = query.trim().toLowerCase();
  const rows = Object.values(tags).filter(
    (t) =>
      !q ||
      tagKey(t.username).includes(q) ||
      (t.text ?? '').toLowerCase().includes(q) ||
      (t.link ?? '').toLowerCase().includes(q),
  );
  const byName = (a: UserTag, b: UserTag) => tagKey(a.username).localeCompare(tagKey(b.username));
  const cmp: Record<TagSort, (a: UserTag, b: UserTag) => number> = {
    name: byName,
    tag: (a, b) =>
      (a.text ?? '').toLowerCase().localeCompare((b.text ?? '').toLowerCase()) || byName(a, b),
    votes: (a, b) => b.votesUp - b.votesDown - (a.votesUp - a.votesDown) || byName(a, b),
    updated: (a, b) => b.updatedAt - a.updatedAt || byName(a, b),
  };
  return rows.sort(cmp[sort]);
}

const PANEL_CSS =
  'position:fixed;z-index:2147483647;top:6vh;left:50%;transform:translateX(-50%);width:min(640px,calc(100vw - 16px));max-height:84vh;display:flex;flex-direction:column;box-sizing:border-box;padding:12px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px Verdana,Arial,sans-serif';
const CELL = 'padding:3px 6px;text-align:left;vertical-align:middle';

let open: { panel: HTMLElement; refresh(): void; close(): void } | null = null;

export function closeTagManager(): void {
  open?.close();
}

/** Re-read storage and redraw, if the manager is open. */
export function refreshTagManager(): void {
  open?.refresh();
}

export function openTagManager(host: ManagerHost): void {
  closeTagManager();
  let tags: UserTags = {};
  let armed: string | null = null; // the user whose delete button asks "Sure?"

  const search = h('input', {
    type: 'search',
    name: 'search',
    'data-rescue-input': '',
    placeholder: 'Search users, tags, links',
    'aria-label': 'Search tagged users',
    title: hint.managerSearch,
  });
  search.style.cssText = 'flex:1;min-width:0';
  const sort = h(
    'select',
    { name: 'sort', 'aria-label': 'Sort tagged users', title: hint.managerSort },
    h('option', { value: 'name' }, 'Sort: user name'),
    h('option', { value: 'tag' }, 'Sort: tag text'),
    h('option', { value: 'votes' }, 'Sort: votes (net)'),
    h('option', { value: 'updated' }, 'Sort: recently changed'),
  );
  const count = h('div', {
    class: 'rescue-tags-count',
    'aria-live': 'polite',
    title: hint.managerCount,
  });
  count.style.cssText = 'margin:6px 0;color:var(--rescue-meta,#666)';
  const body = h('tbody');
  const table = h(
    'table',
    { class: 'rescue-tags-table', title: hint.managerTable },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        ...['User', 'Tag', 'Votes', ''].map((t) => {
          const th = h('th', { scope: 'col' }, t);
          th.style.cssText = CELL;
          return th;
        }),
      ),
    ),
    body,
  );
  table.style.cssText = 'width:100%;border-collapse:collapse';
  const scroller = h('div', null, table);
  scroller.style.cssText = 'overflow:auto;flex:1;min-height:0';
  const closeBtn = h(
    'button',
    { type: 'button', class: 'rescue-tags-close', 'aria-label': 'Close', title: hint.managerClose },
    label.close,
  );
  const head = h('div', null, h('strong', null, 'Tagged users'), closeBtn);
  head.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';
  const controls = h('div', null, search, sort);
  if (host.importBlocked) {
    const imp = h(
      'button',
      {
        type: 'button',
        class: 'rescue-tags-import-blocked',
        title: host.signedIn ? hint.blockedAction : hint.signIn,
        disabled: !host.signedIn,
      },
      label.importBlocked,
    );
    imp.addEventListener('click', () => host.importBlocked?.());
    controls.append(imp);
  }
  controls.style.cssText = 'display:flex;gap:6px;min-width:0';
  search.style.cssText = 'flex:1 1 auto;min-width:0;box-sizing:border-box';
  sort.style.cssText = 'flex:0 1 auto;min-width:0;max-width:45%';
  const panel = h(
    'div',
    { class: 'rescue-tags-manager rescue-overlay', role: 'dialog', 'aria-label': 'Tagged users' },
    head,
    controls,
    count,
    scroller,
  );
  panel.style.cssText = PANEL_CSS;

  const cell = (...kids: Array<Node | string>) => {
    const td = h('td', null, ...kids);
    td.style.cssText = CELL;
    return td;
  };

  function row(t: UserTag): HTMLElement {
    const key = tagKey(t.username);
    const user = h(
      'a',
      {
        href: `/user/${encodeURIComponent(t.username)}/`,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: hint.managerUser(t.username),
      },
      `u/${t.username}`,
    );
    const tagCell = cell();
    if (t.text) tagCell.append(buildTagChip(t, { truncate: true }));
    if (t.ignored) {
      tagCell.append(
        h('em', { class: 'rescue-tags-ignored', title: hint.managerIgnored }, ' ignored'),
      );
    }
    const edit = h(
      'button',
      {
        type: 'button',
        class: 'rescue-tags-edit',
        'aria-label': `Edit ${t.username}`,
        title: hint.managerEdit(t.username),
      },
      'Edit',
    );
    const del = h(
      'button',
      {
        type: 'button',
        class: 'rescue-tags-delete',
        'aria-label': `Delete ${t.username}`,
        title: hint.managerDelete(t.username, armed === key),
      },
      armed === key ? 'Sure?' : 'Delete',
    );
    edit.addEventListener('click', () => host.edit(t.username, edit));
    del.addEventListener('click', () => {
      if (armed !== key) {
        armed = key;
        setTimeout(() => {
          if (armed === key) {
            armed = null;
            if (open?.panel === panel) draw();
          }
        }, 4000);
        draw();
        return;
      }
      armed = null;
      void host.remove(t.username).then(refresh);
    });
    const actions = cell(edit, ' ', del);
    actions.style.whiteSpace = 'nowrap';
    const votes = t.votesUp || t.votesDown ? formatVotes(t.votesUp, t.votesDown) : '';
    return h('tr', { 'data-user': key }, cell(user), tagCell, cell(votes), actions);
  }

  function draw(): void {
    const rows = listTags(tags, search.value, sort.value as TagSort);
    const total = Object.keys(tags).length;
    count.textContent =
      rows.length === total
        ? `${total} tagged user${total === 1 ? '' : 's'}`
        : `${rows.length} of ${total} tagged users`;
    body.replaceChildren(...rows.map(row));
    if (!rows.length) {
      const empty = cell(total ? 'No tags match.' : 'No users tagged yet.');
      empty.colSpan = 4;
      body.append(h('tr', null, empty));
    }
  }

  function refresh(): void {
    void host.load().then((t) => {
      tags = t;
      if (open?.panel === panel) draw();
    });
  }
  // Escape closes the manager wherever focus is (not only in its own search box).
  const onEscape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  function close(): void {
    document.removeEventListener('keydown', onEscape, true);
    panel.remove();
    if (open?.panel === panel) open = null;
  }

  search.addEventListener('input', draw);
  sort.addEventListener('change', draw);
  closeBtn.addEventListener('click', close);
  for (const t of ['keydown', 'keyup', 'keypress']) {
    panel.addEventListener(t, (e) => {
      e.stopPropagation();
      if ((t === 'keyup' || t === 'keydown') && (e as KeyboardEvent).key === 'Escape') close();
    });
  }
  document.body.append(panel);
  document.addEventListener('keydown', onEscape, true);
  open = { panel, refresh, close };
  refresh();
  search.focus();
}
