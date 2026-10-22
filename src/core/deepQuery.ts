/**
 * querySelector / querySelectorAll that also search the OPEN shadow roots below `root` (Reddit's
 * components keep their controls in them). Pure DOM, no state: used by the MAIN-world bridge.
 */
/** querySelector that also searches open shadow roots below `root`. */
export const deepQuery = (root: Element, sel: string): Element | null => {
  const direct = root.querySelector(sel);
  if (direct) return direct;
  const stack: Element[] = [root];
  while (stack.length) {
    const el = stack.pop()!;
    const sr = (el as HTMLElement).shadowRoot;
    if (sr) {
      const hit = sr.querySelector(sel);
      if (hit) return hit;
      stack.push(...sr.querySelectorAll('*'));
    }
    stack.push(...el.children);
  }
  return null;
};

/** Every match below `root`, searching open shadow roots too. */
export const deepQueryAll = (root: Element, sel: string): Element[] => {
  const out: Element[] = [...root.querySelectorAll(sel)];
  const stack: Element[] = [root, ...root.querySelectorAll('*')];
  while (stack.length) {
    const sr = (stack.pop() as HTMLElement).shadowRoot;
    if (!sr) continue;
    out.push(...sr.querySelectorAll(sel));
    stack.push(...sr.querySelectorAll('*'));
  }
  return out;
};
