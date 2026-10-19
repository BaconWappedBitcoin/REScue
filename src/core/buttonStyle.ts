/**
 * The one look for every REScue control in Reddit's credit bars, taglines and thread tools.
 *
 *  - `.rescue-btn`   a control you can click: a small accent-coloured pill with a border, so it
 *                    reads as a button and is distinct from Reddit's own plain-text links.
 *  - `.rescue-label` information only (lean chips, ratios, filter reasons, dates): flat, no
 *                    border, muted colour, default cursor, so it never reads as a button.
 *
 * Colours come from the `--rescue-btn-*` / `--rescue-label-*` variables in theme.ts (light and
 * dark both pass 4.5:1 text contrast). The pill is 20px high to sit on Reddit's credit-bar line,
 * and wraps with the bar rather than clipping at narrow widths.
 */
export const BUTTON_CSS = `
:root .rescue-btn {
  display: inline-flex; align-items: center; box-sizing: border-box;
  height: 20px; min-height: 0; max-width: 100%; margin: 1px 3px; padding: 0 8px;
  border: 1px solid var(--rescue-btn-border, #7ba3cc); border-radius: 10px;
  background: var(--rescue-btn-bg, #e8f0f8); color: var(--rescue-btn-fg, #1d4b7a);
  font: 600 11px/1 system-ui, sans-serif; letter-spacing: 0; text-decoration: none;
  white-space: nowrap; vertical-align: middle; cursor: pointer; overflow: hidden;
  text-overflow: ellipsis;
  /* Above Reddit's whole-card post link, like Reddit's own credit-bar links ("relative"): without
     this, a click on a REScue button in LibreWolf/Firefox opened the post instead. */
  position: relative; z-index: 2;
}
:root .rescue-btn:hover { background: var(--rescue-btn-hover, #d3e4f4); border-color: var(--rescue-accent, #336699); text-decoration: none; }
:root .rescue-btn:focus-visible { outline: 2px solid var(--rescue-accent, #336699); outline-offset: 1px; }
:root .rescue-btn[aria-pressed="true"] { border-color: var(--rescue-accent, #336699); box-shadow: inset 0 0 0 1px var(--rescue-accent, #336699); }
:root .rescue-btn[hidden] { display: none; }
:root .rescue-label {
  display: inline-block; box-sizing: border-box; margin: 0 3px; padding: 0 5px;
  border: 0; border-radius: 3px; background: var(--rescue-label-bg, #f0f0f1);
  color: var(--rescue-label-fg, #4a4a4c); font: 400 11px/18px system-ui, sans-serif;
  white-space: nowrap; vertical-align: middle; cursor: default;
}
:root .rescue-label[hidden] { display: none; }
`;
