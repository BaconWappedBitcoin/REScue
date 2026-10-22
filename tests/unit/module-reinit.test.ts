/**
 * Live off/on: the registry disposes a module with `onSettings` when it is switched off and runs
 * its init again (against the same shared services) when it is switched back on. Every such
 * module must survive init → dispose → init → dispose.
 */
import { KeyDispatcher } from '../../src/core/keys';
import { MODULES } from '../../src/modules';
import { flatThreadHtml, listingHtml, mount } from '../fixtures/pages';
import { bootModules } from './module-harness';

const byId = (id: string) => MODULES.find((d) => d.id === id)!;

describe('re-init after dispose', () => {
  for (const def of MODULES.filter((d) => d.onSettings)) {
    it(def.id, async () => {
      document.body.innerHTML = '<shreddit-app><main></main></shreddit-app>';
      const h = await bootModules([def]);
      const ctx = h.ctxs.get(def.id)!;
      def.dispose?.();
      let err: unknown = null;
      try {
        await def.init?.(ctx as never);
      } catch (e) {
        err = e;
      }
      def.dispose?.();
      expect(String(err ?? '')).toBe('');
    });
  }
});

describe('keyboard commands follow the on/off switch', () => {
  it('register returns a function that removes the command', () => {
    const keys = new KeyDispatcher();
    const run = vi.fn();
    const off = keys.register({ id: 'a', title: 'A', defaultKeys: ['x'], run });
    expect(() => keys.register({ id: 'a', title: 'A2', defaultKeys: ['y'], run })).toThrow(
      /Duplicate command/,
    );
    off();
    expect(keys.list()).toEqual([]);
    expect(keys.run('a')).toBe(false);
    // Removing twice, or after someone else took the id, leaves the other registrant alone.
    keys.register({ id: 'a', title: 'A3', defaultKeys: ['z'], run });
    off();
    expect(keys.list().map((c) => c.title)).toEqual(['A3']);
  });

  for (const [id, cmd] of [
    ['keyboardNav', 'moveDown'],
    ['commentNavigator', 'toggleCommentNavigator'],
  ] as const) {
    it(`${id}: its commands go away when switched off and come back when switched on`, async () => {
      document.body.innerHTML = '<shreddit-app><main></main></shreddit-app>';
      const def = byId(id);
      const h = await bootModules([def]);
      const has = () => h.keys.list().some((c) => c.id === cmd);
      expect(has()).toBe(true);
      def.dispose?.();
      expect(has()).toBe(false);
      await def.init?.(h.ctxs.get(id)! as never);
      expect(has()).toBe(true);
      def.dispose?.();
    });
  }

  it('inlineMedia keeps its keys after off/on', async () => {
    document.body.innerHTML = '<shreddit-app><main></main></shreddit-app>';
    const def = byId('inlineMedia');
    const h = await bootModules([def]);
    const before = h.keys.list().map((c) => c.id);
    expect(before.length).toBeGreaterThan(0);
    def.dispose?.();
    await def.init?.(h.ctxs.get('inlineMedia')! as never);
    expect(h.keys.list().map((c) => c.id)).toEqual(before);
    def.dispose?.();
  });
});

describe('switching a module off withdraws its marks', () => {
  const ignored = (username: string) => ({
    userTags: { [username.toLowerCase()]: { username, voteTally: 0, ignored: true, updatedAt: 1 } },
  });

  it('voteEnhancements: no ratio or score label remains after dispose', async () => {
    mount(listingHtml());
    for (const p of document.querySelectorAll('shreddit-post'))
      p.setAttribute('upvote-ratio', '0.5');
    const def = byId('voteEnhancements');
    const h = await bootModules([def], {
      route: { kind: 'all', path: '/r/all' },
      options: { voteEnhancements: { colorLinkScore: true } },
    });
    h.flush();
    expect(document.querySelector('.rescue-upvote-ratio')).not.toBeNull();
    expect(document.querySelector('.rescue-score-chip')).not.toBeNull();
    def.dispose?.();
    expect(document.querySelector('.rescue-upvote-ratio, .rescue-score-chip')).toBeNull();
    // Switched back on, the labels return.
    await def.init?.(h.ctxs.get(def.id)! as never);
    h.goTo({ kind: 'all', path: '/r/all' });
    h.flush();
    expect(document.querySelector('.rescue-upvote-ratio')).not.toBeNull();
    def.dispose?.();
  });

  it('userTagger: hidden posts come back and its tag chips go', async () => {
    mount(listingHtml());
    const def = byId('userTagger');
    const h = await bootModules([def], {
      route: { kind: 'all', path: '/r/all' },
      stored: ignored('rockpaperblr'),
    });
    h.flush();
    expect(document.querySelector('[data-rescue-hidden]')).not.toBeNull();
    expect(document.querySelector('.rescue-author-extras')).not.toBeNull();
    def.dispose?.();
    expect(document.querySelector('[data-rescue-hidden]')).toBeNull();
    expect(document.querySelector('.rescue-author-extras')).toBeNull();
  });

  it('userTagger: collapsed comments of an ignored user open again', async () => {
    mount(flatThreadHtml());
    const def = byId('userTagger');
    const h = await bootModules([def], { stored: ignored('user0') });
    h.flush();
    expect(document.querySelector('[data-rescue-collapsed]')).not.toBeNull();
    def.dispose?.();
    expect(document.querySelector('[data-rescue-collapsed]')).toBeNull();
    expect(document.querySelector('.rescue-author-extras')).toBeNull();
  });
});
