/**
 * One REScue-owned <style> element per id, written with `textContent` only (never innerHTML), so a
 * stylesheet can be replaced or removed cleanly. An empty stylesheet removes the element.
 */
export function setStyle(id: string, css: string): void {
  const existing = document.getElementById(id);
  if (!css.trim()) {
    existing?.remove();
    return;
  }
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement('style');
  style.id = id;
  if (style.textContent !== css) style.textContent = css;
  if (!style.isConnected) (document.head ?? document.documentElement).appendChild(style);
}

export function removeStyle(id: string): void {
  document.getElementById(id)?.remove();
}
