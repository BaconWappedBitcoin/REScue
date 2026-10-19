/** Mounts the settings console in a shadow root so page CSS cannot reach it. */
import { render } from 'preact';
import { ensureTheme } from '../../core/theme';
import type { ModuleAction, ModuleDefinition, SettingsApi } from '../../core/types';
import { SettingsConsole } from './SettingsConsole';
import css from './console.css?inline';

const HOST_ID = 'rescue-settings';

export interface ConsoleDeps {
  settings: SettingsApi;
  runAction(def: ModuleDefinition, action: ModuleAction, file?: File): Promise<void>;
}

export function openConsole(deps: ConsoleDeps, target?: string, doc: Document = document): void {
  ensureTheme(doc);
  let host = doc.getElementById(HOST_ID);
  if (!host) {
    host = doc.createElement('div');
    host.id = HOST_ID;
    host.className = 'rescue-overlay';
    host.setAttribute('data-rescue-input', '');
    // Keys typed in the console must never reach Reddit's shortcut handlers (research R11).
    for (const t of ['keydown', 'keyup', 'keypress'])
      host.addEventListener(t, (e) => e.stopPropagation());
    host.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape') closeConsole(doc);
    });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
    shadow.appendChild(doc.createElement('div'));
    doc.body.appendChild(host);
  }
  const mountPoint = host.shadowRoot!.lastElementChild as HTMLElement;
  render(
    <SettingsConsole
      settings={deps.settings}
      runAction={deps.runAction}
      target={target}
      onClose={() => closeConsole(doc)}
    />,
    mountPoint,
  );
  host.shadowRoot!.querySelector<HTMLInputElement>('input.search')?.focus();
}

export function closeConsole(doc: Document = document): void {
  const host = doc.getElementById(HOST_ID);
  if (!host) return;
  render(null, host.shadowRoot!.lastElementChild as HTMLElement);
  host.remove();
  if (doc.location.hash.startsWith('#rescue:settings'))
    history.replaceState(null, '', doc.location.pathname + doc.location.search);
}

export const isConsoleOpen = (doc: Document = document): boolean => !!doc.getElementById(HOST_ID);
