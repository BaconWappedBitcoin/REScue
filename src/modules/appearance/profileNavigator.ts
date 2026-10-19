/**
 * profileNavigator (RES profileNavigator: sectionMenu, sectionLinks): quick links to the pages of
 * your own profile (saved, comments, submitted, upvoted, ...) in the REScue menu. Reddit's profile
 * tabs only show up once you are on your profile, and its header has no menu on your name, so the
 * menu is REScue's own list instead of RES's hover menu on the username. Off by default. Ideas from
 * RES lib/modules/profileNavigator.js (GPL-3.0, the RES contributors, commit 4defffc); new code.
 */
import { defineModule, type ModuleContext } from '../../core/types';
import { customLandingPath } from '../listings/listingTweaks';

type Row = Record<string, unknown>;

export const DEFAULT_SECTIONS: Row[] = [
  { label: 'saved', url: './saved' },
  { label: 'comments', url: './comments' },
  { label: 'submitted', url: './submitted' },
  { label: 'upvoted', url: './upvoted' },
  { label: 'downvoted', url: './downvoted' },
  { label: 'hidden', url: './hidden' },
];

/** The path under /user/<name>/ a row points to ("./saved" -> "saved"), or null when unusable. */
export function sectionPath(row: Row): string | null {
  const raw = typeof row.url === 'string' ? row.url.trim().replace(/^\.\//, '') : '';
  return customLandingPath(raw);
}

/** The menu rows for these table rows: a label and the address on this user's profile. */
export function sectionItems(
  rows: readonly Row[],
  username: string,
): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string }> = [];
  for (const row of rows) {
    const path = sectionPath(row);
    if (!path) continue;
    const label = typeof row.label === 'string' && row.label.trim() ? row.label.trim() : path;
    out.push({ label: label.slice(0, 40), href: `/user/${encodeURIComponent(username)}/${path}/` });
  }
  return out;
}

let removers: Array<() => void> = [];

function clear(): void {
  for (const r of removers) r();
  removers = [];
}

function sync(ctx: ModuleContext): void {
  clear();
  const name = ctx.session.username;
  if (ctx.options.sectionMenu !== true || !ctx.session.signedIn || !name) return;
  const rows = ctx.options.sectionLinks as Row[];
  sectionItems(rows, name).forEach((s, i) => {
    removers.push(
      ctx.ui.addMenuItem({
        id: `profile:${i}`,
        label: `My ${s.label}`,
        order: 70 + i / 100,
        hint: () => `REScue: open your ${s.label} page`,
        onClick: () => location.assign(s.href),
      }),
    );
  });
}

export const profileNavigator = defineModule({
  id: 'profileNavigator',
  category: 'appearance',
  title: 'Profile pages in the menu',
  description:
    'Adds your own profile pages (saved, comments, submitted, upvoted, ...) to the REScue menu while you are signed in. RES showed this as a menu on your name in the header; Reddit’s header cannot be given one, so it is part of the REScue menu instead.',
  enabledByDefault: true,
  requiresSignIn: true,
  options: {
    sectionMenu: {
      type: 'boolean',
      default: false,
      title: 'Show my profile pages in the REScue menu',
    },
    sectionLinks: {
      type: 'table',
      default: DEFAULT_SECTIONS,
      dependsOn: 'sectionMenu',
      title: 'Pages to list',
      description:
        'A word for the menu and the page after your user name (./saved, ./upvoted, ./hidden, ...).',
      columns: [
        { key: 'label', title: 'Menu word', type: 'text' },
        { key: 'url', title: 'Page (./saved)', type: 'text' },
      ],
      validateRow: (row) =>
        typeof row.url === 'string' && row.url.trim() !== '' && !sectionPath(row)
          ? 'Use a page name such as ./saved (letters, digits, - _ and / between parts).'
          : null,
    },
  },
  init: sync,
  onSettings: sync,
  dispose: clear,
});
