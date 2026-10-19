import { afterEach, describe, expect, it } from 'vitest';
import { Pipeline } from '../../src/core/pipeline';
import { isShownCached } from '../../src/layout/native/selectionView';
import type { Comment } from '../../src/model/types';
import { mount } from '../fixtures/pages';
import { tick } from './module-harness';

afterEach(() => {
  document.body.innerHTML = '';
});

/** Flat comment markup, as Reddit sometimes ships it: `depth` alone says who replies to whom. */
const flat = (specs: Array<[id: string, depth: number]>): string =>
  specs
    .map(
      ([id, depth]) =>
        `<shreddit-comment thingid="${id}" postid="t3_p" author="u${id}" score="1" depth="${depth}" permalink="/r/x/comments/p/t/${id}/"><div slot="comment">${id}</div></shreddit-comment>`,
    )
    .join('');

/** A started pipeline whose batches are flushed by hand (the observer only requests a flush). */
function observed(): { pipeline: Pipeline; seen: Comment[][] } {
  const seen: Comment[][] = [];
  const pipeline = new Pipeline({
    onBatch: (b) => seen.push(b.comments),
    schedule: () => undefined,
  });
  pipeline.start();
  return { pipeline, seen };
}

const parentsOf = (batches: Comment[][]): Array<[string, string | null]> =>
  batches.flat().map((c) => [c.id, c.parentId]);

describe('pipeline threading of batches', () => {
  it('threads appended batches against the comments before them', async () => {
    mount(
      `<div id="tree">${flat([
        ['c0', 0],
        ['c1', 1],
        ['c2', 2],
      ])}</div>`,
    );
    const { pipeline, seen } = observed();
    pipeline.flush();
    const tree = document.getElementById('tree')!;

    tree.insertAdjacentHTML(
      'beforeend',
      flat([
        ['c3', 1],
        ['c4', 0],
      ]),
    );
    await tick();
    pipeline.flush();
    tree.insertAdjacentHTML(
      'beforeend',
      flat([
        ['c5', 1],
        ['c6', 2],
        ['c7', 1],
      ]),
    );
    await tick();
    pipeline.flush();

    expect(parentsOf(seen)).toEqual([
      ['c0', null],
      ['c1', 'c0'],
      ['c2', 'c1'],
      ['c3', 'c0'],
      ['c4', null],
      ['c5', 'c4'],
      ['c6', 'c5'],
      ['c7', 'c4'],
    ]);
    pipeline.stop();
  });

  it('re-threads when a reply lands before comments already threaded', async () => {
    mount(
      `<div id="tree">${flat([
        ['c0', 0],
        ['c1', 1],
        ['c2', 0],
      ])}</div>`,
    );
    const { pipeline, seen } = observed();
    pipeline.flush();
    seen.length = 0;

    document.querySelector('[thingid="c1"]')!.insertAdjacentHTML('afterend', flat([['late', 1]]));
    await tick();
    pipeline.flush();

    expect(parentsOf(seen)).toEqual([['late', 'c0']]);
    pipeline.stop();
  });

  it('reports only what arrived, once', async () => {
    mount(
      `<div id="tree">${flat([
        ['c0', 0],
        ['c1', 1],
      ])}</div>`,
    );
    const { pipeline } = observed();
    expect(pipeline.flush().comments).toHaveLength(2);
    expect(pipeline.flush().comments).toHaveLength(0);

    document.getElementById('tree')!.insertAdjacentHTML(
      'beforeend',
      flat([
        ['c2', 1],
        ['c3', 0],
      ]),
    );
    await tick();
    expect(pipeline.flush().comments.map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(pipeline.flush().comments).toHaveLength(0);
    pipeline.stop();
  });

  it('keeps bodyHtml available on demand', () => {
    mount(`<div id="tree">${flat([['c0', 0]])}</div>`);
    const { pipeline, seen } = observed();
    pipeline.flush();
    expect(seen[0]![0]!.bodyHtml).toBe('c0');
    pipeline.stop();
  });
});

describe('isShownCached', () => {
  it('agrees with a per-element walk, sharing hidden ancestors', () => {
    mount(
      '<div id="a"><div id="hid" hidden><p id="x"></p></div><div id="vis"><p id="y"></p><p id="z" style="display: none"></p></div></div>',
    );
    const cache = new Map<Element, boolean>();
    const at = (id: string) => isShownCached(document.getElementById(id)!, cache);
    expect(at('x')).toBe(false);
    expect(at('hid')).toBe(false);
    expect(at('y')).toBe(true);
    expect(at('z')).toBe(false);
    expect(at('vis')).toBe(true);
  });
});
