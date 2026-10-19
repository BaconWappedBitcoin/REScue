/** Styles for the subreddit shortcut bar, its edit popup, group menu and delete zone. */
export const BAR_ID = 'rescue-subreddit-bar';
export const STYLE_ID = 'rescue-subreddit-bar-style';
export const POPUP_ID = 'rescue-shortcut-popup';

const B = `#${BAR_ID}`;
const P = `#${POPUP_ID}`;
const FONT = 'font:12px/1.6 system-ui,sans-serif';
const PANEL =
  'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:4px;box-shadow:0 1px 4px var(--rescue-shadow,rgba(0,0,0,.25))';

export const STYLE = [
  `${B}{position:fixed;left:12px;bottom:12px;z-index:2147483639;display:flex;`,
  // `%` of a fixed box is the viewport WITHOUT the scrollbar; `vw` would include it and push the
  // bar's right edge out of sight on a page with a vertical scrollbar.
  `align-items:center;gap:2px;box-sizing:border-box;max-width:calc(100% - 260px);${PANEL};padding:2px 6px;${FONT}}`,
  `${B} [hidden],${P} [hidden]{display:none!important}`,
  `${B} a,${B} button,${P} button{color:inherit;text-decoration:none;padding:0 4px;`,
  'white-space:nowrap;border-radius:3px;font:inherit;background:none;border:0;cursor:pointer}',
  `${B} a:hover,${B} button:hover{text-decoration:underline}`,
  `${B} a[aria-current]{font-weight:600}`,
  `${B} .rescue-bar-sep{color:var(--rescue-meta,#666)}`,
  `${B} .rescue-sc-viewport{display:flex;align-items:center;gap:2px;overflow-x:auto;`,
  'min-width:0;scrollbar-width:none;scroll-behavior:smooth}',
  `${B} .rescue-sc-viewport::-webkit-scrollbar{display:none}`,
  `${B} .rescue-sc-viewport>*{flex:none}`,
  `${B} .rescue-sc-arrow{padding:0 2px}`,
  `${B} .rescue-sc{display:inline-flex;align-items:center;border-radius:3px}`,
  `${B} .rescue-sc.rescue-sc-over{outline:2px solid var(--rescue-accent,#336699)}`,
  `${B} .rescue-sc.rescue-sc-dragging{opacity:.4}`,
  `${B} .rescue-sc-edit{padding:0 2px;opacity:0;font-size:11px}`,
  // The edit word appears after the edit dropdown delay on hover (RES shortcutEditDropdownDelay) and
  // at once for the keyboard; leaving hides it at once (the transition of the end state governs).
  `${B} .rescue-sc:hover .rescue-sc-edit{opacity:1;transition:opacity 0s linear var(--rescue-sc-edit-delay,0ms)}`,
  `${B} .rescue-sc:focus-within .rescue-sc-edit{opacity:1}`,
  `${B}[data-rescue-uppercase] .rescue-sc-viewport a{text-transform:uppercase}`,
  `${B} .rescue-sc a:focus-visible,${B} button:focus-visible{outline:2px solid var(--rescue-accent,#336699)}`,
  `${B} .rescue-sc-group>a::after{content:" ▴";font-size:9px}`,
  `${B} .rescue-sc-menu{position:fixed;z-index:2147483640;display:flex;flex-direction:column;`,
  `${PANEL};padding:2px}`,
  `${B} .rescue-sc-menu a,${B} .rescue-sc-menu button{display:block;text-align:left;padding:1px 8px}`,
  `${B} .rescue-sc-trash{position:fixed;left:12px;bottom:52px;z-index:2147483640;padding:10px 18px;`,
  `${PANEL};border:2px dashed var(--rescue-meta,#666)}`,
  `${B} .rescue-sc-trash.rescue-sc-over{border-color:var(--rescue-accent,#336699);background:var(--rescue-accent,#336699);color:var(--rescue-bg,#fff)}`,
  `${P}{position:fixed;left:12px;bottom:52px;z-index:2147483640;width:260px;box-sizing:border-box;`,
  `${PANEL};padding:8px 10px;${FONT}}`,
  `${P} h2{margin:0 0 6px;font:inherit;font-weight:600}`,
  `${P} label{display:block;margin:4px 0 2px}`,
  `${P} input{box-sizing:border-box;width:100%;font:inherit}`,
  `${P} .rescue-sc-actions{display:flex;gap:6px;margin-top:8px}`,
  `${P} button{padding:1px 8px;border:1px solid var(--rescue-border,#ccc)}`,
  `${P} .rescue-sc-error{margin:4px 0 0;color:var(--rescue-danger,#c33333)}`,
  // Wide pages keep clear of Reddit's left navigation (about 270px) and the bottom-right stack.
  `@media (min-width:1100px){${B}{left:280px;max-width:min(720px,calc(100% - 280px - 180px))}}`,
  `@media (max-width:900px){${B}{bottom:56px;max-width:calc(100% - 24px)}${P}{bottom:96px}}`,
].join('');
