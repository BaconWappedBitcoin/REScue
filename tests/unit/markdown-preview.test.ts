import { describe, expect, it } from 'vitest';
import { renderMarkdown, safeHref, SPOILER_CLASS } from '../../src/model/markdownPreview';

/** Render into a box and return it (the tests read its structure, never set innerHTML). */
const render = (src: string): HTMLDivElement => {
  const box = document.createElement('div');
  box.append(renderMarkdown(src));
  return box;
};
const tags = (el: Element): string[] => [...el.children].map((c) => c.tagName.toLowerCase());

describe('Markdown preview', () => {
  it('splits paragraphs on blank lines and breaks lines Reddit’s way', () => {
    const box = render('one\ntwo\n\nthree  \nfour\\\nfive');
    expect(tags(box)).toEqual(['p', 'p']);
    expect(box.children[0]!.textContent).toBe('one two');
    expect(box.children[1]!.querySelectorAll('br')).toHaveLength(2);
    expect(box.children[1]!.textContent).toBe('threefourfive');
  });

  it('renders bold, italic, strike, superscript and code', () => {
    const p = render('**b** *i* _j_ ~~s~~ ^up ^(two words) `a*b*`').firstElementChild!;
    expect(p.querySelector('strong')!.textContent).toBe('b');
    expect([...p.querySelectorAll('em')].map((e) => e.textContent)).toEqual(['i', 'j']);
    expect(p.querySelector('del')!.textContent).toBe('s');
    expect([...p.querySelectorAll('sup')].map((e) => e.textContent)).toEqual(['up', 'two words']);
    expect(p.querySelector('code')!.textContent).toBe('a*b*');
    expect(p.querySelector('code em')).toBeNull();
  });

  it('nests inline styles and keeps snake_case and lone stars as text', () => {
    const p = render('**bold *and italic***  snake_case_name 2 * 3').firstElementChild!;
    expect(p.querySelector('strong em')!.textContent).toBe('and italic');
    expect(p.textContent).toContain('snake_case_name 2 * 3');
  });

  it('honours backslash escapes', () => {
    expect(render('\\*not italic\\*').firstElementChild!.querySelector('em')).toBeNull();
    expect(render('\\*not italic\\*').textContent).toBe('*not italic*');
  });

  it('renders fenced code blocks verbatim', () => {
    const box = render('```\n**x** <b>y</b>\n  z\n```\nafter');
    expect(tags(box)).toEqual(['pre', 'p']);
    expect(box.querySelector('pre > code')!.textContent).toBe('**x** <b>y</b>\n  z');
  });

  it('renders quotes (nested) with their own blocks', () => {
    const box = render('> quoted **bold**\n> > deeper\n\nout');
    expect(tags(box)).toEqual(['blockquote', 'p']);
    const q = box.firstElementChild!;
    expect(q.querySelector('strong')!.textContent).toBe('bold');
    expect(q.querySelector('blockquote')!.textContent).toBe('deeper');
  });

  it('renders bullet and numbered lists', () => {
    const box = render('- a\n* b\n\n1. one\n2) two');
    expect(tags(box)).toEqual(['ul', 'ol']);
    expect([...box.querySelectorAll('ul > li')].map((l) => l.textContent)).toEqual(['a', 'b']);
    expect([...box.querySelectorAll('ol > li')].map((l) => l.textContent)).toEqual(['one', 'two']);
  });

  it('renders headings and rules', () => {
    const box = render('# Title\n### Small ##\n---\ntext');
    expect(tags(box)).toEqual(['h1', 'h3', 'hr', 'p']);
    expect(box.querySelector('h3')!.textContent).toBe('Small');
  });

  it('renders http(s) links, relative Reddit links and bare addresses', () => {
    const box = render('[site](https://example.com/a) [sub](/r/aww) see https://x.org/p.');
    const links = [...box.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/a',
      'https://www.reddit.com/r/aww',
      'https://x.org/p',
    ]);
    expect(links.map((a) => a.textContent)).toEqual(['site', 'sub', 'https://x.org/p']);
    expect(links.every((a) => a.rel.includes('noopener'))).toBe(true);
    expect(box.textContent!.endsWith('.')).toBe(true);
  });

  it('shows >!spoilers!< as a spoiler box', () => {
    const sp = render('it was >!the butler!< all along').querySelector(`.${SPOILER_CLASS}`)!;
    expect(sp.tagName).toBe('SPAN');
    expect(sp.textContent).toBe('the butler');
  });

  it('a line starting with a spoiler is not a quote', () => {
    expect(tags(render('>!secret!< text'))).toEqual(['p']);
  });
});

describe('Markdown preview safety (XSS)', () => {
  it('keeps raw HTML as inert text', () => {
    const box = render('<img src=x onerror="alert(1)"> <script>alert(2)</script> **<b>x</b>**');
    expect(box.querySelector('img, script, b')).toBeNull();
    expect(box.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(box.textContent).toContain('<script>alert(2)</script>');
    for (const el of box.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) expect(attr.startsWith('on')).toBe(false);
    }
  });

  it('never links javascript:, data: or vbscript: targets', () => {
    const src =
      '[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](data:text/html,<script>x</script>) ' +
      '[d](vbscript:msgbox) [e]( javascript:alert(1)) javascript:alert(3)';
    const box = render(src);
    expect(box.querySelector('a')).toBeNull();
    expect(box.textContent).toContain('[a](javascript:alert(1))');
  });

  it('only ever writes http(s) hrefs', () => {
    const box = render('[x](https://ok.example) [y](//evil.example/x) [z](ftp://f.example)');
    for (const a of box.querySelectorAll('a')) expect(a.href).toMatch(/^https?:\/\//);
    expect(box.querySelectorAll('a')).toHaveLength(2);
  });

  it('safeHref accepts only http and https', () => {
    expect(safeHref('https://a.example/')).toBe('https://a.example/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/plain,hi')).toBeNull();
    expect(safeHref('mailto:a@b.c')).toBeNull();
  });
});
