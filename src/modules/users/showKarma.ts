/**
 * showKarma (RES showKarma, gap build H1): your own post and comment karma as words in REScue's
 * tool strip. The numbers come from Reddit's own user hover-card partial (research R4/R6, the same
 * read-only same-origin request the hover-card features use, cached for half an hour); nothing
 * is sent anywhere else, and `/user/<name>/about.json` is not used because it is not an endpoint
 * the contracts list. Placement beside the header username is not possible (the header is Reddit's
 * sealed component), so the numbers sit in the tool strip. Ported in spirit from RES
 * lib/modules/showKarma.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { HovercardService } from '../../core/hovercards';
import { defineModule } from '../../core/types';

const MAX_SEPARATOR = 5;
const DEFAULT_SEPARATOR = '·';

export interface KarmaFormat {
  showCommentKarma: boolean;
  separator: string;
  useCommas: boolean;
}

/** The separator to use: trimmed, at most five characters, never empty. */
export function cleanSeparator(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, MAX_SEPARATOR) : '';
  return s || DEFAULT_SEPARATOR;
}

const num = (n: number, commas: boolean): string =>
  commas ? n.toLocaleString('en-US') : String(Math.trunc(n));

/** "Karma 1,234 · 567": post karma, then (optionally) comment karma. Pure. */
export function formatKarma(post: number, comment: number | undefined, f: KarmaFormat): string {
  const parts = [num(post, f.useCommas)];
  if (f.showCommentKarma && comment !== undefined) parts.push(num(comment, f.useCommas));
  return `Karma ${parts.join(` ${cleanSeparator(f.separator)} `)}`;
}

let node: HTMLElement | null = null;
let service: HovercardService | null = null;
let token = 0;

async function load(
  name: string,
  format: KarmaFormat,
  place: (n: HTMLElement) => void,
): Promise<void> {
  const mine = ++token;
  service ??= new HovercardService();
  const r = await service.user(name);
  if (mine !== token || r.state !== 'ready' || r.card.postKarma === undefined) return;
  const text = formatKarma(r.card.postKarma, r.card.commentKarma, format);
  if (!node) {
    node = h('span', { class: 'rescue-karma', title: hint.showKarma });
    node.style.cssText = 'font-size:12px;padding:0 6px;white-space:nowrap';
    place(node);
  }
  node.textContent = text;
}

interface Startable {
  session: { username: string | null };
  options: Readonly<Record<string, unknown>>;
  ui: { addHeaderTool(node: HTMLElement): void };
}

function start(ctx: Startable): void {
  const name = ctx.session.username;
  if (!name) return;
  const format: KarmaFormat = {
    showCommentKarma: Boolean(ctx.options.showCommentKarma),
    separator: String(ctx.options.separator),
    useCommas: Boolean(ctx.options.useCommas),
  };
  void load(name, format, (n) => ctx.ui.addHeaderTool(n));
}

export const showKarma = defineModule({
  id: 'showKarma',
  resId: 'showKarma',
  category: 'users',
  title: 'Show karma',
  description:
    'Shows your own post karma and comment karma as words in REScue’s tool strip. The numbers are read from Reddit’s own user card for you (one small request, kept for half an hour). Needs you to be signed in. RES showed it beside your name in the header; Reddit’s header cannot be changed, so it sits in the tool strip.',
  enabledByDefault: false,
  options: {
    showCommentKarma: {
      type: 'boolean',
      default: true,
      title: 'Show comment karma too',
    },
    separator: {
      type: 'text',
      default: DEFAULT_SEPARATOR,
      title: 'Separator between the two numbers',
      dependsOn: 'showCommentKarma',
    },
    useCommas: {
      type: 'boolean',
      default: true,
      title: 'Use thousands separators (1,234)',
    },
  },

  init(ctx) {
    start(ctx);
  },

  onSettings(ctx) {
    start(ctx);
  },

  dispose() {
    token++;
    node?.remove();
    node = null;
    service = null;
  },
});
