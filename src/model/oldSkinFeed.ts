/**
 * Old Reddit look: feed rows and search results (research R23, second pass R24).
 *
 * A feed post whose REScue rows are mounted (`data-rescue-ov`, see modules/appearance/oldSkin) is a
 * one-row grid: rank, vote column, thumbnail, body (title line, tagline, link row). Everything else
 * of Reddit's own post is PARKED in the grid's hidden second row: the pseudo-element `::after`
 * covers every cell of the first row, so the items of the post's shadow root that CSS cannot name
 * (the action row with the vote pill, comments pill and share; shape B's title wrapper) are
 * auto-placed into the implicit rows below, which are 0 high, and the post clips them
 * (`overflow: clip`, no bottom padding). They stay in the page and keep working (the bridge presses
 * their buttons), they are just never drawn. Reddit's light-DOM pieces are parked the same way, by
 * a default `grid-area` that the pieces REScue shows override. A post that is not mounted keeps
 * Reddit's own look.
 */
import { C } from '../contracts/reddit';
import { ROOT, scoped, thumbPx, type OldSkinOptions } from './oldSkinBase';

/** hidePromoted's marker on an ad it hid (modules/listings/hidePromoted/hider.ts MARK). */
const PROMOTED_MARK = 'data-rescue-promoted';

export function feedCss(o: OldSkinOptions): string {
  const k = C.skin;
  const s = k.postSlots;
  const px = thumbPx(o.thumbnails);
  const none = px === 0;
  const P = `${ROOT} ${C.feed} :is(${C.post}, ${C.adPost})[${k.mountAttr}]`;
  const A = `${P} > ${k.wrapA}`;
  const rank = o.rankNumbers ? 'counter(osrank)' : '""';
  const rankW = o.rankNumbers ? 34 : 0;
  const rules: string[] = [
    `${ROOT} ${C.feed} { counter-reset: osrank; }`,
    `${ROOT} ${C.feed} > ${k.feedDivider} { display: none; }`,
    `${ROOT} ${C.feed} > ${C.postWrapper} { margin: 0 !important; }`,
    `${P} {
  counter-increment: osrank; display: grid !important; position: relative; overflow: clip;
  grid-template-columns: ${rankW}px 46px ${px}px minmax(0, 1fr); grid-template-rows: auto; grid-auto-rows: 0;
  column-gap: 0; row-gap: 0; align-items: start;
  background: transparent !important; border-radius: 0 !important; margin: 0 !important; padding: 0 !important;
  font-family: var(--os-font); font-size: 10px; color: var(--os-meta);
}`,
    `${P}::before { content: ${rank}; grid-area: 1 / 1; color: var(--os-rank); font: normal 15px arial, sans-serif; text-align: right; padding: 16px ${o.rankNumbers ? 8 : 0}px 0 0; }`,
    // Fills every cell of the first row, so auto-placed items (the sealed ones) fall below it.
    `${P}::after { content: ""; grid-area: 1 / 1 / 2 / -1; pointer-events: none; }`,
    // Everything of Reddit's own is parked in the hidden row; the pieces REScue shows are placed below.
    `${P} > *, ${A} > * { grid-area: 2 / 1; }`,
    `${A} { display: contents; }`,
    `${P} > .rescue-ovote { grid-area: 1 / 2; }`,
    `${P} > .rescue-oth { grid-area: 1 / 3; ${none ? 'display: none;' : ''} }`,
    `${P} > .rescue-obody { grid-area: 1 / 4; padding-left: ${none ? 0 : 8}px; }`,
    // A real thumbnail or media preview takes the thumbnail cell and the placeholder steps aside.
    `${P}:has(${s.thumbnail}:not(:empty)) > .rescue-oth, ${P}:has(> ${C.mediaContainer}) > .rescue-oth { display: none; }`,
    // Pieces drawn through a slot (Firefox): Reddit's thumbnail is out of reach, so the placeholder shows its picture.
    ...(none ? [] : [`${P} > .rescue-oth[slot] { display: block !important; width: ${px}px; height: ${Math.round(px * 0.75)}px; }`]),
    // A video never plays in a feed under this look: Reddit's player is hidden from the first paint
    // (never on screen, so never autoplayed) and the thumbnail shows its poster (open the post to watch).
    `${ROOT} ${C.feed} :is(${C.post}, ${C.adPost}) ${k.videoPlayer}, ${P}:has(${k.videoPlayer}) > ${C.mediaContainer} { display: none !important; }`,
    ...(none ? [] : [`${P}:has(${k.videoPlayer}) > .rescue-oth { display: block !important; width: ${px}px; height: ${Math.round(px * 0.75)}px; }`]),
    `${A} > ${k.wrapAThumb} { grid-area: 1 / 3; width: ${px}px; ${none ? 'display: none;' : ''} }`,
    `${P} ${s.thumbnail} { width: ${px}px; height: auto; max-height: ${Math.round(px * 0.75)}px; border-radius: 0; }`,
    `${P} ${s.thumbnail} > a { width: 100%; height: auto; }`,
    // A large picture or video (shape B) shrinks to thumbnail size (zoom scales the whole box), or goes away.
    `${P} > ${C.mediaContainer} { grid-area: 1 / 3; width: 583px; zoom: ${(px / 583).toFixed(4)}; height: 437px; overflow: hidden; background: var(--os-panel); margin: 4px 0 !important; ${none ? 'display: none;' : ''} }`,
    `${P} > ${C.mediaContainer} * { pointer-events: none; }`,
    // Reddit's credit bar stays alive (its overflow menu is how save / hide / report are pressed) but unseen.
    `${P} ${s.credit} { position: absolute !important; left: 0; top: 0; width: 1px; height: 1px; margin: 0 !important; padding: 0 !important; clip-path: inset(50%); pointer-events: none; }`,
    // Reddit's full-card link only serves the "comments" word's passed-through click.
    `${P} > a[slot="full-post-link"] { pointer-events: none; }`,
    `${P}[${C.postFlagAttrs.stickied}] .rescue-otitle { color: var(--os-sticky); }`,
    `${scoped(P, '.rescue-hide-link')} { display: none; }`,
    // Pinned posts (modules/appearance/oldSkin/highlights.ts): the feed's own columns, a green title.
    `${ROOT} .rescue-osticky { margin: 2px 0 4px; }`,
    `${ROOT} .rescue-ostick { display: grid; grid-template-columns: ${rankW}px 46px ${px}px minmax(0, 1fr); align-items: start; font-family: var(--os-font); font-size: 10px; color: var(--os-meta); }`,
    `${ROOT} .rescue-ostick > .rescue-ostick-vote { grid-column: 2; display: flex; justify-content: center; padding-top: 18px; }`,
    `${ROOT} .rescue-ostick > .rescue-oth { grid-column: 3; width: ${px}px; height: ${Math.round(px * 0.75)}px; ${none ? 'display: none;' : ''} }`,
    `${ROOT} .rescue-ostick > .rescue-obody { grid-column: 4; padding-left: ${none ? 0 : 8}px; }`,
    `${ROOT} .rescue-ostick-title { color: var(--os-sticky) !important; }`,
    `${ROOT} .rescue-ostick-word { color: var(--os-sticky); font-weight: bold; }`,
    // An ad that "Hide promoted posts" hid stays hidden: this row style must not bring it back
    // (it outranks that module's display:none), or it leaves a blank, numbered gap.
    `${P}[${PROMOTED_MARK}] { display: none !important; }`,
    // An ad says so, as old Reddit's promoted rows did.
    `${P} .rescue-oad { margin-left: 4px; padding: 0 3px; border: 1px solid var(--os-border); color: var(--os-meta); font-size: 9px; text-transform: lowercase; }`,
  ];
  return rules.join('\n');
}

export function searchCss(o: OldSkinOptions): string {
  const k = C.skin.search;
  const px = thumbPx(o.thumbnails);
  const M = `${ROOT} ${C.main}`;
  const unit = scoped(M, k.unit);
  const title = scoped(M, k.title);
  return [
    `${M} ${k.divider} { display: none; }`,
    `${unit} { flex-direction: row-reverse !important; justify-content: flex-end !important; align-items: flex-start !important; gap: ${px ? 8 : 0}px; padding: 4px 0 !important; min-height: 0 !important; }`,
    // The thumbnail is a fixed 120px box; zoom scales it to the chosen size (or hides it).
    `${scoped(M, k.unit, ` > ${k.thumb}`)} { width: 120px !important; zoom: ${(px / 120).toFixed(4)}; flex: none; ${px ? '' : 'display: none;'} }`,
    `${title} { font: normal 16px arial, sans-serif !important; color: var(--os-link) !important; }`,
    `${scoped(M, k.title, ':visited')} { color: var(--os-visited) !important; }`,
    `${M} ${k.body} { font-size: 10px; }`,
    `${scoped(`${M} ${k.body}`, k.meta)} { font-size: 10px; color: var(--os-meta); }`,
  ].join('\n');
}
