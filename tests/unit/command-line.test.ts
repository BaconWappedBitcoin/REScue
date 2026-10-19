import { describe, expect, it } from 'vitest';
import { parseCommand } from '../../src/modules/core/commandLine';
import type { ModuleDefinition, Route } from '../../src/core/types';

const defs = [
  { id: 'filteReddit', title: 'filteReddit', locked: false, enabledByDefault: true },
  { id: 'settingsConsole', title: 'Settings console', locked: true, enabledByDefault: true },
] as unknown as ModuleDefinition[];

const ctx = (route: Partial<Route> = {}) =>
  ({
    route: {
      kind: 'subreddit',
      path: '/r/rust',
      subreddit: 'rust',
      ...route,
    },
    settings: { definitions: () => defs },
    keys: { list: () => [{ id: 'moveDown', title: 'Move down', keys: ['j'] }] },
  }) as never;

describe('command line', () => {
  it.each([
    ['r/programming', '/r/programming/'],
    ['/r/AskReddit/', '/r/AskReddit/'],
    ['u/spez', '/user/spez/'],
    ['all', '/r/all/'],
    ['front', '/'],
    ['top', '/r/rust/top/'],
    ['hot', '/r/rust/'],
    ['search async traits', '/r/rust/search/?q=async%20traits'],
  ])('%s → %s', (input, target) => {
    expect(parseCommand(input, ctx())).toMatchObject({ kind: 'go', target });
  });

  it('searches site-wide from r/all', () => {
    expect(parseCommand('search x', ctx({ subreddit: 'all' })).target).toBe('/search/?q=x');
  });

  it('opens settings for a feature and toggles unlocked features only', () => {
    expect(parseCommand('settings filteReddit', ctx())).toMatchObject({
      kind: 'settings',
      target: 'filteReddit',
    });
    expect(parseCommand('toggle filteReddit', ctx())).toMatchObject({
      kind: 'toggle',
      target: 'filteReddit',
    });
    expect(parseCommand('toggle settingsConsole', ctx()).kind).toBe('unknown');
  });

  it('runs keyboard commands by id or title, and rejects junk', () => {
    expect(parseCommand('moveDown', ctx())).toMatchObject({ kind: 'command', target: 'moveDown' });
    expect(parseCommand('Move down', ctx())).toMatchObject({ kind: 'command', target: 'moveDown' });
    expect(parseCommand('r/../../etc', ctx()).kind).toBe('unknown');
  });
});
