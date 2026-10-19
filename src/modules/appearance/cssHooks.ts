/**
 * CSS hooks for the stylesheet module (RES stylesheet: subredditClass, multiredditClass,
 * usernameClass, loggedInUserClass, bodyClasses, snippets). Pure functions: which classes belong on
 * the page for a route, and which table rows (body classes, snippets) apply to it. Ideas from RES
 * lib/modules/stylesheet.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { customToggleOn } from '../core/presets';
import type { SettingsProfile } from '../../core/settings';
import type { Route } from '../../core/types';

export const APPLY_TO = [
  { value: 'everywhere', label: 'Everywhere' },
  { value: 'exclude', label: 'Everywhere but the subreddits listed' },
  { value: 'include', label: 'Only on the subreddits listed' },
] as const;

export interface HookRow {
  /** Body classes (space or comma separated) or the CSS of a snippet. */
  classes?: unknown;
  snippet?: unknown;
  applyTo?: unknown;
  subreddits?: unknown;
  customToggle?: unknown;
}

export interface HookFlags {
  subredditClass: boolean;
  multiredditClass: boolean;
  usernameClass: boolean;
  loggedInUserClass: boolean;
}

const safe = (name: string): string => name.replace(/[^A-Za-z0-9_-]/g, '');
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** `r/foo`, `/r/Foo/` and `foo` all name the subreddit "foo" (lower-cased). */
export function subredditList(raw: unknown): string[] {
  return text(raw)
    .split(/[\s,]+/)
    .map((s) =>
      s
        .replace(/^\/?r\//i, '')
        .replace(/\/$/, '')
        .toLowerCase(),
    )
    .filter(Boolean);
}

/** The name of the custom feed (multireddit) on this route, or null. */
export function feedName(route: Route): string | null {
  if (route.kind !== 'customFeed') return null;
  return /\/m\/([^/]+)/.exec(route.path)?.[1] ?? null;
}

/** The classes REScue's options add for this route. */
export function routeClasses(route: Route, me: string | null, flags: HookFlags): string[] {
  const cls = (on: boolean, prefix: string, name: string | null | undefined): string[] =>
    on && name && safe(name) ? [`${prefix}${safe(name)}`] : [];
  return [
    ...cls(flags.subredditClass, 'res-r-', route.subreddit),
    ...cls(flags.multiredditClass, 'res-m-', feedName(route)),
    ...cls(flags.usernameClass && route.kind === 'profile', 'res-u-', route.username),
    ...cls(flags.loggedInUserClass, 'res-user-', me),
  ];
}

/** Does a body-class or snippet row apply on this route, with its custom toggle on? */
export function rowApplies(row: HookRow, route: Route, profile: SettingsProfile): boolean {
  const toggle = text(row.customToggle);
  if (toggle && !customToggleOn(profile, toggle)) return false;
  const mode = text(row.applyTo) || 'everywhere';
  if (mode === 'everywhere') return true;
  const here = route.subreddit?.toLowerCase() ?? '';
  const listed = !!here && subredditList(row.subreddits).includes(here);
  return mode === 'include' ? listed : !listed;
}

/** Class names from a row's text, kept to safe characters. */
export function classTokens(raw: unknown): string[] {
  return text(raw)
    .split(/[\s,]+/)
    .map(safe)
    .filter(Boolean);
}
