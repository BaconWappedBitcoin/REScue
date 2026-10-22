/**
 * A small Markdown renderer for the big editor's live preview (RES commentPreview). It covers the
 * subset people use in comments: paragraphs, line breaks (two trailing spaces or a backslash, as
 * Reddit reads them), **bold**, *italic*, ~~strike~~, ^superscript / ^(several words), `code`,
 * fenced code blocks, > quotes, - and 1. lists, # headings, --- rules, [text](url) and bare
 * http(s) links, and >!spoilers!<.
 *
 * Safety: the output is built with createElement / createTextNode only, never innerHTML, so any
 * HTML in the source stays text. A link gets an href only when it resolves to http: or https:;
 * anything else (javascript:, data:, ...) is shown as plain text.
 *
 * Speed: no pattern here can backtrack over a long line (each is linear, and closing markers are
 * looked up once per line), and only the first PREVIEW_MAX_CHARS characters are rendered, so a
 * hostile paste cannot freeze the page.
 */

/** The preview renders this many characters at most, and says so when it stops short. */
export const PREVIEW_MAX_CHARS = 40_000;

export const SPOILER_CLASS = 'rescue-md-spoiler';

/** Styles for a preview box with class `rescue-md`: a spoiler is a dark box until pointed at. */
export const PREVIEW_CSS = [
  '.rescue-md{overflow-wrap:anywhere}',
  '.rescue-md p,.rescue-md ul,.rescue-md ol,.rescue-md pre,.rescue-md blockquote{margin:0 0 .6em}',
  '.rescue-md blockquote{border-left:3px solid var(--rescue-border,#ccc);padding-left:8px;color:var(--rescue-meta,#666)}',
  '.rescue-md pre{background:var(--rescue-surface,#edeff1);padding:6px;overflow:auto}',
  '.rescue-md code{font-family:ui-monospace,monospace;background:var(--rescue-surface,#edeff1)}',
  '.rescue-md a{color:var(--rescue-accent,#336699)}',
  `.rescue-md .${SPOILER_CLASS}{background:#1a1a1b;color:#1a1a1b;border-radius:2px;padding:0 2px}`,
  `.rescue-md .${SPOILER_CLASS}:hover{color:#fff}`,
].join('\n');

const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const FENCE = /^\s*(```|~~~)/;
const QUOTE = /^\s*>(?!!)\s?/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d{1,9}[.)]\s+(.*)$/;
const RULE = /^\s*(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;

/** The href for a link target, or null when it is not an http(s) address. */
export function safeHref(target: string, base = 'https://www.reddit.com/'): string | null {
  let url: URL;
  try {
    url = new URL(target.trim(), base);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

/** A heading's text without its optional closing hashes ("## Title ##"); "C#" keeps its hash. */
function headingText(raw: string): string {
  const t = raw.trimEnd();
  let k = t.length;
  while (k > 0 && t[k - 1] === '#') k--;
  return k < t.length && (k === 0 || t[k - 1] === ' ' || t[k - 1] === '\t')
    ? t.slice(0, k).trimEnd()
    : t;
}

/** Render `source` (its first PREVIEW_MAX_CHARS characters) into a fragment of plain DOM nodes. */
export function renderMarkdown(source: string, doc: Document = document): DocumentFragment {
  const out = doc.createDocumentFragment();
  const cut = source.length > PREVIEW_MAX_CHARS;
  const text = cut ? source.slice(0, PREVIEW_MAX_CHARS) : source;
  renderBlocks(text.replace(/\r\n?/g, '\n').split('\n'), out, doc, 0);
  if (cut) {
    const note = doc.createElement('p');
    note.className = 'rescue-md-cut';
    note.textContent = `… The preview shows the first ${PREVIEW_MAX_CHARS.toLocaleString('en-US')} characters.`;
    out.appendChild(note);
  }
  return out;
}

function renderBlocks(lines: string[], parent: Node, doc: Document, depth: number): void {
  let i = 0;
  const para: string[] = [];
  const flush = (): void => {
    if (!para.length) return;
    const p = doc.createElement('p');
    para.forEach((line, n) => {
      // Plain string checks: / {2,}$/ backtracks over every run of spaces in a long line.
      const hard = line.endsWith('  ') || line.endsWith('\\');
      const text = (line.endsWith('\\') ? line.slice(0, -1) : line).trim();
      renderInline(text, p, doc);
      if (n < para.length - 1) p.append(hard ? doc.createElement('br') : doc.createTextNode(' '));
    });
    parent.appendChild(p);
    para.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) body.push(lines[i++]!);
      i++; // the closing fence (or the end)
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      code.textContent = body.join('\n');
      pre.append(code);
      parent.appendChild(pre);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const el = doc.createElement(`h${heading[1]!.length}`);
      renderInline(headingText(heading[2]!), el, doc);
      parent.appendChild(el);
      i++;
      continue;
    }
    if (RULE.test(line)) {
      flush();
      parent.appendChild(doc.createElement('hr'));
      i++;
      continue;
    }
    if (QUOTE.test(line) && depth < 8) {
      flush();
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(lines[i++]!.replace(QUOTE, ''));
      const quote = doc.createElement('blockquote');
      renderBlocks(inner, quote, doc, depth + 1);
      parent.appendChild(quote);
      continue;
    }
    const listRe = BULLET.test(line) ? BULLET : NUMBER.test(line) ? NUMBER : null;
    if (listRe) {
      flush();
      const list = doc.createElement(listRe === BULLET ? 'ul' : 'ol');
      while (i < lines.length && listRe.test(lines[i]!)) {
        const li = doc.createElement('li');
        renderInline(listRe.exec(lines[i]!)![1]!.trim(), li, doc);
        list.append(li);
        i++;
      }
      parent.appendChild(list);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
}

/** Paired inline markers, longest first: [opener, closer, element]. */
const PAIRS: Array<[string, string, string]> = [
  ['>!', '!<', 'span'],
  ['**', '**', 'strong'],
  ['__', '__', 'strong'],
  ['~~', '~~', 'del'],
  ['*', '*', 'em'],
  ['_', '_', 'em'],
];

const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/**
 * Lookups on one line that remember their answers, so trying a marker at every position of a
 * long line never rescans the rest of it (an unclosed `[`, `>!` or `^(` repeated 10 000 times
 * would otherwise be quadratic).
 */
function lineIndex(text: string) {
  const found = new Map<string, [from: number, at: number]>();
  /** text.indexOf(token, from), remembered: no occurrence lies between a query and its answer. */
  const find = (token: string, from: number): number => {
    const c = found.get(token);
    if (c && from >= c[0] && (c[1] < 0 || from <= c[1])) return c[1];
    const at = text.indexOf(token, from);
    found.set(token, [from, at]);
    return at;
  };
  let wsFrom = -1;
  let wsAt = -1;
  /** The first whitespace at or after `from` (text.length when none); asked in increasing order. */
  const nextSpace = (from: number): number => {
    if (wsFrom >= 0 && from >= wsFrom && from <= wsAt) return wsAt;
    let k = from;
    while (k < text.length && !isSpace(text[k])) k++;
    wsFrom = from;
    wsAt = k;
    return k;
  };
  const skipped = new Map<number, number>();
  /** The first non-whitespace at or after `from` (text.length when none). */
  const skipSpace = (from: number): number => {
    let k = skipped.get(from);
    if (k === undefined) {
      k = from;
      while (isSpace(text[k])) k++;
      skipped.set(from, k);
    }
    return k;
  };
  const targets = new Map<number, { target: string; end: number } | null>();
  /** `(target "title")` starting at `open`; the target has no spaces or `)` (as on Reddit). */
  const parseTarget = (open: number): { target: string; end: number } | null => {
    const start = skipSpace(open + 1);
    const paren = find(')', start);
    if (paren < 0) return null;
    const stop = Math.min(paren, nextSpace(start));
    if (stop === start) return null;
    const target = text.slice(start, stop);
    if (stop === paren) return { target, end: paren + 1 };
    let k = skipSpace(stop);
    if (text[k] === '"') {
      const quote = find('"', k + 1);
      if (quote < 0) return null;
      k = skipSpace(quote + 1);
    }
    return text[k] === ')' ? { target, end: k + 1 } : null;
  };
  /** `[label](target "title")` at `i` (text[i] is `[`): its parts and where it ends, or null. */
  const link = (i: number): { label: string; target: string; end: number } | null => {
    const close = find(']', i + 1);
    if (close < 0 || text[close + 1] !== '(') return null;
    let t = targets.get(close);
    if (t === undefined) {
      t = parseTarget(close + 1);
      targets.set(close, t);
    }
    return t && { label: text.slice(i + 1, close), target: t.target, end: t.end };
  };
  return { find, link };
}

const BARE_URL = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/;
/** The characters that can start something other than plain text. */
const MARKERS = new Set(['\\', '`', '[', 'h', 'H', '^', '>', '*', '_', '~']);

function renderInline(text: string, parent: Node, doc: Document, depth = 0): void {
  const { find, link } = lineIndex(text);
  let plain = '';
  const emit = (): void => {
    if (plain) parent.appendChild(doc.createTextNode(plain));
    plain = '';
  };
  const nest = (tag: string, inner: string): HTMLElement => {
    const el = doc.createElement(tag);
    if (depth < 12) renderInline(inner, el, doc, depth + 1);
    else el.textContent = inner;
    return el;
  };

  let i = 0;
  outer: while (i < text.length) {
    const ch = text[i]!;
    if (!MARKERS.has(ch)) {
      plain += ch;
      i++;
      continue;
    }
    const rest = text.slice(i);
    const prev = i > 0 ? text[i - 1]! : ' ';

    if (ch === '\\' && i + 1 < text.length && /[\\`*_{}[\]()#+\-.!|>~^<]/.test(text[i + 1]!)) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = find('`', i + 1);
      if (end > i + 1) {
        emit();
        const code = doc.createElement('code');
        code.textContent = text.slice(i + 1, end);
        parent.appendChild(code);
        i = end + 1;
        continue;
      }
    }
    if (ch === '[') {
      const m = link(i);
      if (m) {
        const href = safeHref(m.target);
        if (href) {
          emit();
          const a = nest('a', m.label || m.target) as HTMLAnchorElement;
          a.href = href;
          a.rel = 'noopener noreferrer nofollow';
          a.target = '_blank';
          parent.appendChild(a);
        } else {
          plain += text.slice(i, m.end); // not an http(s) link: show the source as text
        }
        i = m.end;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H') && !/[\w/]/.test(prev)) {
      const m = BARE_URL.exec(rest);
      const href = m && safeHref(m[0]);
      if (m && href) {
        emit();
        const a = doc.createElement('a');
        a.href = href;
        a.rel = 'noopener noreferrer nofollow';
        a.target = '_blank';
        a.textContent = m[0];
        parent.appendChild(a);
        i += m[0].length;
        continue;
      }
    }
    if (ch === '^') {
      if (text[i + 1] === '(') {
        const end = find(')', i + 2);
        if (end > i + 2) {
          emit();
          parent.appendChild(nest('sup', text.slice(i + 2, end)));
          i = end + 1;
          continue;
        }
      } else {
        const m = /^\^(\S+)/.exec(rest);
        if (m) {
          emit();
          parent.appendChild(nest('sup', m[1]!));
          i += m[0].length;
          continue;
        }
      }
    }
    for (const [open, close, tag] of PAIRS) {
      if (!rest.startsWith(open)) continue;
      // An underscore inside a word (snake_case) is not emphasis.
      if (open[0] === '_' && /\w/.test(prev)) continue;
      const from = i + open.length;
      if (text[from] === ' ' || from >= text.length) continue;
      let end = find(close, from + 1);
      if (end < 0) continue;
      // "***" closing "**...*...": the closer is the LAST two stars of the run.
      if (open === close && close.length > 1) {
        while (text[end + close.length] === close[0]) end++;
      }
      if (open.length === 1 && text[end + 1] === open) continue; // half of a ** pair
      emit();
      const el = nest(tag, text.slice(from, end));
      if (open === '>!') el.className = SPOILER_CLASS;
      parent.appendChild(el);
      i = end + close.length;
      continue outer;
    }
    plain += ch;
    i++;
  }
  emit();
}
