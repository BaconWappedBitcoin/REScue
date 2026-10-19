/**
 * RES backup importer (T119): reads a backup file made by the Reddit Enhancement Suite and brings
 * over user tags and filteReddit filters, reporting what it imported and what it skipped.
 *
 * The file is untrusted input. It is size-capped, parsed with JSON.parse only (nothing is ever
 * evaluated), and every value is validated before it reaches REScue's own stores.
 *
 * File and storage shapes follow RES (GPL-3.0, Copyright (C) the RES contributors, commit
 * 4defffc12235b86b50e458d9f3565c96376609ec); the code is new:
 *  - lib/modules/backupAndRestore/serialization.js: file wrapper, schema versions 0 to 2;
 *  - lib/modules/userTagger.js (tagStorage, Tag.load): one `tag.<lower-case name>` key per user,
 *    `{text, link, color, votesUp, votesDown}`; older backups hold `RESmodules.userTagger.tags`
 *    (lib/core/migrate/migrate.js, '4.4.x' case fix and '5.6.1-shard-tags'), `{tag, color, link,
 *    votes, ignore}` per user;
 *  - lib/modules/filteReddit.js (module.options, getStringMatchConditions): options are stored as
 *    `RESoptions.filteReddit` = `{ <option>: { value } }`, and a table option's rows are arrays in
 *    field order.
 */
import { BACKUP_FORMAT } from '../../core/backup';
import { resolveOptions, setOption } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';
import { filteReddit } from '../listings/filteReddit';
import { RULE_TYPES, type FilterRule } from '../listings/filteReddit/rules';
import { COLOR_PRESETS } from '../users/tagColors';
import {
  sanitizeTags,
  validColor,
  validLink,
  type UserTag,
  type UserTags,
} from '../users/tagStore';
import {
  convertFilters,
  isObj,
  mergeRules,
  own,
  shown,
  type ImportMode,
  type Json,
} from './resImportFilters';

export { convertFilters, mergeRules, type ImportMode } from './resImportFilters';

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_TAG_TEXT = 100;
const MAX_NOTICE_LINES = 5;
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

// --- file ------------------------------------------------------------------------------------

export type ParseResult = { ok: true; storage: Json } | { ok: false; error: string };

/** RES serialization.js deserialize(): schema 2 `{data}`, schema 1 flat, schema 0 JSON strings. */
export function parseResBackup(text: string): ParseResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, error: 'The file is larger than 20 MB.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!isObj(raw)) return { ok: false, error: 'The file is not an RES backup.' };
  if (own(raw, 'format') === BACKUP_FORMAT) {
    return {
      ok: false,
      error: 'This is a REScue backup. Use "Import backup file" in Backup & restore.',
    };
  }
  const version = own(raw, 'SCHEMA_VERSION');
  if (version === 2) {
    const data = own(raw, 'data');
    return isObj(data)
      ? { ok: true, storage: data }
      : { ok: false, error: 'The file is not an RES backup (no data).' };
  }
  const { SCHEMA_VERSION: _v, ...rest } = raw;
  if (version === 1) return { ok: true, storage: rest };
  // Schema 0: every value is a JSON-encoded string; fall back to the raw string as RES does.
  const storage: Json = {};
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v !== 'string') {
      storage[k] = v;
      continue;
    }
    try {
      storage[k] = JSON.parse(v);
    } catch {
      storage[k] = v;
    }
  }
  return { ok: true, storage };
}

// --- tags ------------------------------------------------------------------------------------

/** userTagger.js bgToTextColorMap: the colours RES's tag editor offered, as #rrggbb. */
const NAMED_COLORS: Record<string, string> = Object.fromEntries(
  COLOR_PRESETS.flatMap((p) => (p.hex ? [[p.name, p.hex]] : [])),
);

function convertColor(value: unknown): { color?: string; note?: string } {
  if (typeof value !== 'string' || !value.trim() || value.trim().toLowerCase() === 'none')
    return {};
  const v = value.trim().toLowerCase();
  const named = Object.prototype.hasOwnProperty.call(NAMED_COLORS, v) ? NAMED_COLORS[v] : undefined;
  const hex = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  const color =
    named ?? (hex ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : validColor(v));
  return color ? { color } : { note: `colour “${shown(value, 20)}” not recognised` };
}

const toInt = (v: unknown): number => {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? Math.trunc(v) : 0;
  return Number.isSafeInteger(n) ? n : 0;
};

function convertTag(name: string, raw: Json, legacy: boolean, now: number) {
  const notes: string[] = [];
  const text = String((legacy ? own(raw, 'tag') : own(raw, 'text')) ?? '')
    .trim()
    .slice(0, MAX_TAG_TEXT);
  // Current RES keeps the two counts; the legacy format only had a net `votes`, which is stored as
  // upvotes (positive) or downvotes (negative).
  const net = legacy ? toInt(own(raw, 'votes')) : 0;
  const votesUp = legacy ? Math.max(net, 0) : Math.max(toInt(own(raw, 'votesUp')), 0);
  const votesDown = legacy ? Math.max(-net, 0) : Math.max(toInt(own(raw, 'votesDown')), 0);
  const ig = own(raw, 'ignore');
  const ignored = legacy && (ig === true || ig === 'true');
  const tag: UserTag = {
    username: name,
    votesUp,
    votesDown,
    voteTally: votesUp - votesDown,
    ignored,
    updatedAt: now,
  };

  const { color, note } = convertColor(own(raw, 'color'));
  // RES allows several space-separated links; REScue keeps the first valid http(s) one.
  const rawLink = own(raw, 'link');
  const link =
    typeof rawLink === 'string' ? rawLink.split(/\s+/).map(validLink).find(Boolean) : undefined;
  if (note) notes.push(note);
  if (text) {
    tag.text = text;
    if (color) tag.color = color;
    if (link) tag.link = link;
    if (typeof rawLink === 'string' && rawLink.trim() && !link) notes.push('link is not http(s)');
  } else if (color || link) {
    notes.push('colour or link without tag text is not kept');
  }
  const meaningful = !!tag.text || votesUp > 0 || votesDown > 0 || tag.ignored;
  return { tag: meaningful ? tag : null, notes };
}

export interface TagConversion {
  tags: UserTags;
  /** Entries found in the file that were objects. */
  found: number;
  skipped: string[];
}

export function convertTags(storage: Json, now: number): TagConversion {
  const found = new Map<string, { raw: Json; legacy: boolean }>();
  const legacy = own(storage, 'RESmodules.userTagger.tags');
  if (isObj(legacy)) {
    for (const [k, v] of Object.entries(legacy))
      if (isObj(v)) found.set(k.toLowerCase(), { raw: v, legacy: true });
  }
  for (const [k, v] of Object.entries(storage)) {
    if (k.startsWith('tag.') && isObj(v))
      found.set(k.slice(4).toLowerCase(), { raw: v, legacy: false });
  }

  const out: Array<[string, UserTag]> = [];
  const skipped: string[] = [];
  for (const [name, { raw, legacy: isLegacy }] of found) {
    if (!USERNAME.test(name) || name === '__proto__') {
      skipped.push(`tag “${shown(name)}”: not a valid Reddit username`);
      continue;
    }
    const { tag, notes } = convertTag(name, raw, isLegacy, now);
    if (!tag) {
      skipped.push(`tag “${name}”: nothing to keep${notes.length ? ` (${notes.join('; ')})` : ''}`);
      continue;
    }
    out.push([name, tag]);
    if (notes.length) skipped.push(`tag “${name}”: imported, but ${notes.join('; ')}`);
  }
  return { tags: Object.fromEntries(out), found: found.size, skipped };
}

export function mergeTags(existing: UserTags, incoming: UserTags, mode: ImportMode) {
  const out = new Map(Object.entries(existing));
  let added = 0;
  let replaced = 0;
  let kept = 0;
  for (const [key, tag] of Object.entries(incoming)) {
    if (!out.has(key)) {
      out.set(key, tag);
      added++;
    } else if (mode === 'replace') {
      out.set(key, tag);
      replaced++;
    } else kept++;
  }
  return { tags: Object.fromEntries(out) as UserTags, added, replaced, kept };
}

// --- plan and report -------------------------------------------------------------------------

export interface ImportReport {
  tagsAdded: number;
  tagsReplaced: number;
  tagsKept: number;
  rulesAdded: number;
  rulesDuplicate: number;
  nsfwChanged: boolean;
  skipped: string[];
}

export interface ImportPlan {
  tags: UserTags;
  rules: FilterRule[];
  hideNsfw: boolean | undefined;
  report: ImportReport;
}

export function planImport(
  storage: Json,
  current: { tags: UserTags; rules: FilterRule[]; hideNsfw: boolean },
  mode: ImportMode,
  now: number,
): ImportPlan {
  const t = convertTags(storage, now);
  const f = convertFilters(storage);
  const tags = mergeTags(current.tags, t.tags, mode);
  const rules = mergeRules(current.rules, f.rules, mode);
  // Merge only ever turns the NSFW filter on; replace follows the file.
  const hideNsfw =
    f.hideNsfw === undefined || (mode === 'merge' && !f.hideNsfw) ? undefined : f.hideNsfw;
  return {
    tags: tags.tags,
    rules: rules.rules,
    hideNsfw,
    report: {
      tagsAdded: tags.added,
      tagsReplaced: tags.replaced,
      tagsKept: tags.kept,
      rulesAdded: rules.added,
      rulesDuplicate: rules.duplicates,
      nsfwChanged: hideNsfw !== undefined && hideNsfw !== current.hideNsfw,
      skipped: [...t.skipped, ...f.skipped],
    },
  };
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The text shown to the user: what came in, what stayed, what was skipped. */
export function describeReport(r: ImportReport): string {
  const imported = r.tagsAdded + r.tagsReplaced + r.rulesAdded;
  const parts: string[] = [
    `Imported ${count(r.tagsAdded + r.tagsReplaced, 'user tag')} and ${count(r.rulesAdded, 'filter')}` +
      (r.nsfwChanged ? ' and the NSFW filter switch' : '') +
      '.',
  ];
  if (r.tagsKept) parts.push(`${count(r.tagsKept, 'existing tag')} kept as they were.`);
  if (r.rulesDuplicate) parts.push(`${count(r.rulesDuplicate, 'filter')} already present.`);
  if (r.skipped.length) {
    const head = r.skipped.slice(0, MAX_NOTICE_LINES).join('; ');
    const more = r.skipped.length - MAX_NOTICE_LINES;
    parts.push(
      `Skipped or changed ${r.skipped.length}: ${head}${more > 0 ? `; and ${more} more (listed in the browser console)` : ''}.`,
    );
  }
  if (!imported && !r.skipped.length && !r.tagsKept && !r.rulesDuplicate)
    return 'Nothing to import: the file has no RES user tags or filteReddit filters.';
  return parts.join(' ');
}

// --- module ----------------------------------------------------------------------------------

async function runImport(ctx: ModuleContext, file: File | undefined): Promise<void> {
  if (!file) return;
  const fail = (msg: string) =>
    ctx.notices.show(`REScue: RES import failed. ${msg}`, { kind: 'error', id: 'res-import' });
  if (file.size > MAX_IMPORT_BYTES) return fail('The file is larger than 20 MB.');
  const parsed = parseResBackup(await file.text());
  if (!parsed.ok) return fail(parsed.error);

  const mode = ctx.options.importMode === 'replace' ? 'replace' : 'merge';
  const profile = ctx.settings.profile();
  const opts = resolveOptions(filteReddit, profile);
  const plan = planImport(
    parsed.storage,
    {
      tags: sanitizeTags(await ctx.data.get<unknown>('userTags')),
      rules: (opts.rules as unknown as FilterRule[]).filter((r) =>
        (RULE_TYPES as string[]).includes(String(r?.type)),
      ),
      hideNsfw: opts.hideNsfw,
    },
    mode,
    Date.now(),
  );

  const { report } = plan;
  if (report.tagsAdded + report.tagsReplaced > 0) ctx.data.set('userTags', plan.tags);
  if (report.rulesAdded > 0 || report.nsfwChanged) {
    let next = setOption(
      profile,
      filteReddit,
      'rules',
      plan.rules.map((r) => ({ ...r })),
    );
    if (plan.hideNsfw !== undefined) next = setOption(next, filteReddit, 'hideNsfw', plan.hideNsfw);
    await ctx.settings.save(next);
  }
  if (report.skipped.length) console.info('[REScue] RES import skipped:', report.skipped);
  ctx.notices.show(`REScue: ${describeReport(report)} Reload Reddit tabs to apply it.`, {
    kind: report.skipped.length ? 'warning' : 'info',
    id: 'res-import',
    timeoutMs: 30_000,
  });
}

export const resImport = defineModule({
  id: 'resImport',
  resId: 'backupAndRestore',
  category: 'core',
  title: 'Import from RES',
  description:
    'Bring your user tags and filteReddit filters over from a Reddit Enhancement Suite backup file (RES settings › Backup & Restore › Backup to file). Nothing else is imported, nothing is uploaded, and the file is only read. Colours become #rrggbb, only http(s) links are kept, and filters that have no REScue equivalent or an invalid pattern are skipped and listed.',
  enabledByDefault: true,
  options: {
    importMode: {
      type: 'enum',
      default: 'merge',
      title: 'When importing',
      description:
        'Merge adds what is new and keeps your existing tags and filters. Replace overwrites the tag of every user in the file and, when the file has filters, replaces your whole filter list with them.',
      values: [
        { value: 'merge', label: 'Merge: keep what is already here' },
        { value: 'replace', label: 'Replace matching tags and the filter list' },
      ],
    },
  },
  actions: [
    {
      id: 'import',
      label: 'Import RES backup file',
      kind: 'file',
      confirm:
        'Import user tags and filters from this RES backup? With "Replace", matching tags are overwritten and, if the file has filters, your filter list is replaced.',
      run: runImport,
    },
  ],
});
