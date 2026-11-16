/**
 * Hover text for the Topic filters controls. It follows the rules of src/core/hints.ts (every text
 * starts with "REScue: ") but lives here because that file is at its size limit.
 */
const r = (s: string): string => `REScue: ${s}`;

export const text = {
  /** The REScue menu row. */
  menu: (on: string[]): string =>
    on.length
      ? r(`hiding posts from these topics: ${on.join(', ')}. Click to change`)
      : r('hide whole topics (sports, politics, anime …) from your feeds. Click to choose'),
  panel: r('tick a topic to hide every post from its subreddits; untick to show them again'),
  checkbox: (label: string, description: string): string =>
    r(`${label}: ${description}. Tick to hide these subreddits in your feeds`),
  more: r('open the Topic filters settings: add subreddits to a topic or never hide some'),
};
