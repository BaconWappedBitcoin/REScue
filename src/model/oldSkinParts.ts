/**
 * Old Reddit look: how REScue's own replacement rows look (the vote column, the title line, the
 * tagline, the flat link row, a comment's points, the placeholder thumbnail). They are REScue's own
 * light-DOM elements (modules/appearance/oldSkin), so they are styled here like any other element;
 * every rule starts with the skin attribute, so nothing shows when the skin is off.
 */
import { C } from '../contracts/reddit';
import { ROOT } from './oldSkinBase';

const UP = 'polygon(50% 0, 100% 52%, 72% 52%, 72% 100%, 28% 100%, 28% 52%, 0 52%)';
const DOWN = 'polygon(28% 0, 72% 0, 72% 48%, 100% 48%, 50% 100%, 0 48%, 28% 48%)';

export function partsCss(): string {
  const k = C.skin;
  const R = ROOT;
  const meta = `${R} ${C.main} ${C.comment}[${k.mountAttr}] > ${k.comment.head} ${k.comment.meta}`;
  return [
    // The vote column: arrows grey until hovered or voted, the score between them.
    `${R} .rescue-ovote { display: flex; flex-direction: column; align-items: center; gap: 1px; padding-top: 4px; font-family: arial, sans-serif; box-sizing: border-box; }`,
    // The button is a roomy invisible box and the arrow is drawn inside it: a clip-path on the
    // button itself would also clip where it can be clicked, down to the 15x14 triangle.
    `${R} .rescue-oarrow { all: unset; box-sizing: border-box; width: 30px; height: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; }`,
    `${R} .rescue-oarrow::before { content: ""; width: 15px; height: 14px; background: var(--os-arrow); }`,
    `${R} .rescue-oup::before { clip-path: ${UP}; }`,
    `${R} .rescue-odown::before { clip-path: ${DOWN}; }`,
    `${R} .rescue-oup:hover::before, ${R} .rescue-oup[aria-pressed="true"]::before { background: var(--os-up); }`,
    `${R} .rescue-odown:hover::before, ${R} .rescue-odown[aria-pressed="true"]::before { background: var(--os-down); }`,
    `${R} .rescue-oarrow:focus-visible { outline: 2px solid var(--os-link); }`,
    `${R} .rescue-ovote[aria-busy="true"] .rescue-oarrow { opacity: .5; cursor: progress; }`,
    `${R} .rescue-onum { font: bold 13px/1.2 var(--os-font); color: var(--os-meta); min-height: 15px; text-align: center; }`,
    `${R} .rescue-ovote[data-vote="up"] .rescue-onum { color: var(--os-up); }`,
    `${R} .rescue-ovote[data-vote="down"] .rescue-onum { color: var(--os-down); }`,
    `${R} .rescue-obody [hidden] { display: none !important; }`,
    // The body block of a post: the title line, the tagline, the flat link row.
    `${R} .rescue-obody { min-width: 0; padding: 3px 4px 4px 0; font: 10px/1.4 var(--os-font); color: var(--os-meta); }`,
    `${R} .rescue-oline { font: normal 16px/1.2 var(--os-font); margin: 0 0 1px; overflow-wrap: anywhere; }`,
    `${R} .rescue-otitle { color: var(--os-link); text-decoration: none; cursor: pointer; }`,
    `${R} .rescue-otitle:visited { color: var(--os-visited); }`,
    `${R} .rescue-otitle:hover { text-decoration: underline; }`,
    `${R} .rescue-oflair { display: inline-block; vertical-align: 1px; margin-left: 4px; padding: 0 4px; border: 1px solid var(--os-border); border-radius: 2px; background: var(--os-flair-bg, var(--os-panel)); color: var(--os-flair-fg, var(--os-fg)); font: 10px/1.5 var(--os-font); }`,
    `${R} .rescue-onsfw { display: inline-block; vertical-align: 1px; margin-left: 4px; padding: 0 3px; border: 1px solid #d10023; border-radius: 2px; color: #d10023; font: bold 10px/1.4 var(--os-font); }`,
    `${R} .rescue-odomain { color: var(--os-meta); font-size: 10px; }`,
    `${R} .rescue-otag { color: var(--os-meta); font-size: 11px; line-height: 15px; }`,
    `${R} .rescue-oauthor, ${R} .rescue-osub { color: var(--os-tag); text-decoration: none; }`,
    `${R} .rescue-oauthor:hover, ${R} .rescue-osub:hover { text-decoration: underline; }`,
    `${R} .rescue-oend { display: inline; }`,
    `${R} .rescue-olinks { display: flex; flex-wrap: wrap; gap: 0 8px; margin: 0; padding: 1px 0; list-style: none; font-weight: bold; line-height: 16px; color: var(--os-meta); }`,
    `${R} .rescue-olinks li { margin: 0; padding: 0; }`,
    `${R} .rescue-olink, ${R} .rescue-ocomments { all: unset; box-sizing: border-box; font: bold 10px/1.4 var(--os-font); color: var(--os-meta); cursor: pointer; text-decoration: none; }`,
    `${R} .rescue-olink:hover, ${R} .rescue-ocomments:hover { text-decoration: underline; }`,
    `${R} .rescue-olink:focus-visible, ${R} .rescue-ocomments:focus-visible { outline: 1px dotted var(--os-link); }`,
    `${R} .rescue-olink[aria-busy="true"] { opacity: .5; cursor: progress; }`,
    // A post with no thumbnail of its own gets old Reddit's grey placeholder (text posts: a page of lines).
    `${R} .rescue-oth { box-sizing: border-box; width: 70px; height: 70px; margin: 0; border-radius: 3px; background: var(--os-panel) center / 60% no-repeat; border: 1px solid var(--os-border); cursor: pointer; }`,
    `${R} .rescue-oth[data-kind="self"] { background-image: linear-gradient(var(--os-rank) 0 0), linear-gradient(var(--os-rank) 0 0), linear-gradient(var(--os-rank) 0 0); background-size: 56% 2px, 56% 2px, 36% 2px; background-position: 50% 30%, 50% 50%, 36% 70%; }`,
    `${R} .rescue-oth[data-kind="img"] { background: var(--os-panel) var(--os-thumb) center / cover no-repeat; }`,
    `${R} .rescue-oth[data-kind="link"] { background-image: radial-gradient(circle, var(--os-rank) 0 22%, transparent 24%); background-size: 40% 70%; }`,
    // A comment: the points text in its head, the old "[–]" mark, the flat link row under the body.
    `${R} .rescue-ocv { position: absolute; left: 0; top: 2px; width: 22px; z-index: 1; }`,
    `${R} .rescue-ocv .rescue-onum { display: none; }`,
    `${R} .rescue-ocv { gap: 0; }`,
    `${R} .rescue-ocv .rescue-oarrow { width: 22px; }`,
    `${R} .rescue-opts { color: var(--os-meta); font: 10px/1.4 var(--os-font); margin-left: 6px; white-space: nowrap; }`,
    `${R} .rescue-ocl { margin: 1px 0 6px; padding-left: 0; }`,
    `${meta}::before { content: "[–]"; order: -1; margin-right: 4px; color: var(--os-meta); font: 10px/1.4 var(--os-font); cursor: pointer; }`,
    `${R} ${C.main} ${C.comment}[${k.mountAttr}]:has(> details:not([open])) > ${k.comment.head} ${k.comment.meta}::before { content: "[+]"; }`,
    `${meta} a[href*="/user/"] { font-weight: bold; color: var(--os-tag); font-size: 10px; text-decoration: none; }`,
    // Reddit's own bullet and relative time in the head are replaced by REScue's "2 hours ago".
    `${meta} ${k.timeBullet}, ${meta} ${k.timeLink} { display: none !important; }`,
    `${meta} ${k.timeago} { display: none; }`,
  ].join('\n');
}
