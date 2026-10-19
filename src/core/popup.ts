/**
 * Places an absolutely positioned popup next to its anchor so it is always fully on screen: below
 * the anchor when it fits, otherwise above it, clamped sideways into the viewport; if neither side
 * is tall enough the popup is limited to the roomier side and scrolls inside itself. Call it AFTER
 * the popup is in the document (it has to be measured).
 */
const GAP = 4;
const MARGIN = 8;

export function placePopup(box: HTMLElement, anchor: Element, doc: Document = document): void {
  const root = doc.documentElement;
  const view = doc.defaultView;
  const sx = view?.scrollX ?? 0;
  const sy = view?.scrollY ?? 0;
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  const a = anchor.getBoundingClientRect();

  box.style.maxHeight = '';
  box.style.overflowY = '';
  const width = box.offsetWidth;
  const height = box.offsetHeight;

  const below = vh - a.bottom - GAP - MARGIN;
  const above = a.top - GAP - MARGIN;
  let top: number;
  let room = height;
  if (height <= below) top = a.bottom + GAP;
  else if (height <= above) top = a.top - GAP - height;
  else if (below >= above) {
    top = a.bottom + GAP;
    room = Math.max(120, below);
  } else {
    room = Math.max(120, above);
    top = a.top - GAP - room;
  }
  if (room < height) {
    box.style.maxHeight = `${room}px`;
    box.style.overflowY = 'auto';
  }
  // A popup that cannot fit either side at its minimum still stays inside the viewport.
  top = Math.max(MARGIN, Math.min(top, vh - Math.min(height, room) - MARGIN));
  const left = Math.max(MARGIN, Math.min(a.left, vw - width - MARGIN));
  box.style.left = `${left + sx}px`;
  box.style.top = `${top + sy}px`;
}
