/**
 * What the user tagger offers other modules (the hover-card actions): open its tag editor for a
 * user and read / flip the user's ignore flag. userTagger registers it while it is running.
 */
export interface TaggerApi {
  edit(user: string, anchor: Element): void;
  /** Set the visible tag text (keeps the colour and link); blank clears it. */
  setText(user: string, text: string): Promise<void>;
  isIgnored(user: string): boolean;
  toggleIgnore(user: string): Promise<void>;
}

let api: TaggerApi | null = null;

export const setTaggerApi = (next: TaggerApi | null): void => {
  api = next;
};

/** The running tagger, or null when the user tagger is off. */
export const taggerApi = (): TaggerApi | null => api;
