/**
 * Builders for the same-origin JSON answers REScue reads (research R20 item 4), shaped like the
 * live responses seen on 2026-10-15. Test data only.
 */

export interface FixtureSub {
  name: string;
  over18?: boolean;
  subscribers?: number;
}

export function minePage(subs: FixtureSub[], after: string | null = null): unknown {
  return {
    kind: 'Listing',
    data: {
      after,
      before: null,
      children: subs.map((s) => ({
        kind: 't5',
        data: {
          display_name: s.name,
          display_name_prefixed: `r/${s.name}`,
          url: `/r/${s.name}/`,
          over18: s.over18 ?? false,
          subscribers: s.subscribers ?? 1000,
        },
      })),
    },
  };
}

export interface FixtureInfo {
  /** Full name, e.g. "t3_text1". */
  id: string;
  comments: number;
  title?: string;
}

export function infoListing(posts: FixtureInfo[]): unknown {
  return {
    kind: 'Listing',
    data: {
      after: null,
      children: posts.map((p) => ({
        kind: 't3',
        data: {
          name: p.id,
          title: p.title ?? `Title of ${p.id}`,
          num_comments: p.comments,
          locked: false,
          saved: false,
          hidden: false,
          likes: null,
          score: 10,
        },
      })),
    },
  };
}

export function commentsDoc(
  post: FixtureInfo,
  comments: Array<{ id: string; controversiality?: number }>,
) {
  return [
    infoListing([post]),
    {
      kind: 'Listing',
      data: {
        children: comments.map((c) => ({
          kind: 't1',
          data: {
            name: c.id,
            controversiality: c.controversiality ?? 0,
            gilded: 0,
            score_hidden: false,
            score: 3,
          },
        })),
      },
    },
  ];
}

export const meDoc = (name: string): unknown => ({ kind: 't2', data: { name } });

export function blockedList(names: string[]): unknown {
  return {
    kind: 'UserList',
    data: {
      children: names.map((name, i) => ({ name, id: `t2_${i}`, date: 1.7e9, rel_id: `r${i}` })),
    },
  };
}
