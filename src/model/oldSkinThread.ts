/**
 * Old Reddit look: the post at the top of a thread and its comments (research R23, second pass R24).
 *
 * The thread post is parked like a feed post (see oldSkinFeed.ts): once REScue's rows are mounted it
 * is a grid of the vote column and the body block (title line, tagline, link row), then Reddit's own
 * media and text body in the rows below; the first three rows are covered by `::after`, so Reddit's
 * sealed title wrapper and action row fall into the hidden rows after them. Comments have no shadow
 * root, so their head, body, indent and link row are plain CSS; Reddit's own action row is parked
 * (kept alive for the bridge, unseen) while the comment's rows are mounted.
 */
import { C } from '../contracts/reddit';
import { ROOT } from './oldSkinBase';

export function threadCss(): string {
  const k = C.skin;
  const s = k.postSlots;
  const T = `${ROOT} ${C.main} > ${C.post}[${k.mountAttr}]`;
  const K = `${ROOT} ${C.main} ${C.comment}[${k.mountAttr}]`;
  const c = k.comment;
  return [
    `${T} {
  display: grid !important; position: relative; overflow: clip;
  grid-template-columns: 46px minmax(0, 1fr); grid-template-rows: auto auto auto; grid-auto-rows: 0; align-items: start;
  background: transparent !important; margin: 0 !important; padding: 0 !important; border-radius: 0 !important;
  font-family: var(--os-font); font-size: 10px; color: var(--os-meta);
}`,
    `${T}::after { content: ""; grid-area: 1 / 1 / 4 / -1; pointer-events: none; }`,
    `${T} > * { grid-area: 4 / 1; }`,
    `${T} > .rescue-ovote { grid-area: 1 / 1; }`,
    `${T} > .rescue-oth { display: none; }`,
    `${T} > .rescue-obody { grid-area: 1 / 2; }`,
    `${T} > ${C.mediaContainer} { grid-area: 2 / 2; padding-top: 4px; }`,
    `${T} > ${s.textBody} { grid-area: 3 / 2; font-size: 14px; color: var(--os-fg); }`,
    `${T} ${s.credit} { position: absolute !important; left: 0; top: 0; width: 1px; height: 1px; margin: 0 !important; padding: 0 !important; clip-path: inset(50%); pointer-events: none; }`,
    `${T} .rescue-oline { font-size: 18px; }`,
    `${T} .rescue-otitle[data-kind="self"] { color: var(--os-fg); }`,
    // Comments: no avatar column, a one-line head, small body text, a narrow indent with a dotted line.
    `${K} { font-family: var(--os-font); position: relative; }`,
    `${K} > ${c.head} { grid-template-columns: minmax(0, 1fr) !important; padding-left: 22px !important; min-height: 0 !important; }`,
    `${K} > ${k.commentAvatarBox} { display: none !important; }`,
    `${K} > ${c.head} ${c.meta} { padding: 0 !important; font-size: 10px; min-height: 0; align-items: baseline; flex-wrap: wrap; }`,
    `${K} > ${c.head} > div:not(${c.meta}) { display: none; }`,
    `${K} > ${k.commentBox} { grid-template-columns: 22px minmax(0, 1fr) !important; row-gap: 0 !important; }`,
    `${K} > ${k.commentBox} > .rescue-ocl { grid-column: 2; }`,
    `${K} ${c.body} { font-size: 14px; line-height: 1.4; padding-bottom: 0 !important; }`,
    `${K} ${c.line}, ${K} > ${k.commentBox} > svg { display: none; }`,
    // The children sit 25px in from the parent's edge (3px past the parent's text), behind a dotted line.
    `${K} > ${k.commentBox} > ${k.commentChildren} { display: block !important; margin: 0 0 0 25px; border-left: 1px dotted var(--os-line); }`,
    // Reddit's own action row stays in the page for the bridge, unseen.
    // While Reddit's reply box is open in it, the row is shown (the box is Reddit's own, and has to be seen).
    `${K} > ${k.commentBox} > ${k.commentActionBox}:has(${k.commentComposer}) { grid-column: 2; }`,
    `${K} > ${k.commentBox} > ${k.commentActionBox}:not(:has(${k.commentComposer})) { position: absolute !important; width: 1px; height: 1px; margin: 0 !important; padding: 0 !important; clip-path: inset(50%); pointer-events: none; }`,
    `${K}:has(> details:not([open])) > .rescue-ovote { display: none; }`,
  ].join('\n');
}
