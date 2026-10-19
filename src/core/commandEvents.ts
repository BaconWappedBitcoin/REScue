/**
 * A tiny request bus between the command line and the modules a command drives (the comment
 * navigator, filteReddit). The command line fires a request; the module that owns the feature, if
 * it is running, handles it and marks it handled, so the command line can say so when nothing did.
 * No module imports another through this: they only share this file.
 */
export const COMMAND_EVENT = 'rescue:command';

export interface CommandRequest {
  /** nav: open the comment navigator (arg = category); fp: filters power; fl: filter bar. */
  name: 'nav' | 'fp' | 'fl';
  arg?: string;
  /** Set by the module that handled the request. */
  handled: boolean;
  /** What to tell the reader, if the module has something to say. */
  message?: string;
}

/** Fire a request and return it with `handled` filled in. */
export function sendCommand(name: CommandRequest['name'], arg?: string): CommandRequest {
  const detail: CommandRequest = { name, ...(arg !== undefined ? { arg } : {}), handled: false };
  document.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail }));
  return detail;
}

/** Listen for requests; returns the function that stops listening. */
export function onCommand(handler: (req: CommandRequest) => void): () => void {
  const listener = (e: Event): void => handler((e as CustomEvent<CommandRequest>).detail);
  document.addEventListener(COMMAND_EVENT, listener);
  return () => document.removeEventListener(COMMAND_EVENT, listener);
}
