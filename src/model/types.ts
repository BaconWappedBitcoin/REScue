/** Transient page models (specs/001-rescue-foundation/data-model.md). Never persisted. */

export type PostType = 'text' | 'link' | 'image' | 'gallery' | 'video' | 'crosspost' | 'other';
export const POST_TYPES: readonly PostType[] = [
  'text',
  'link',
  'image',
  'gallery',
  'video',
  'crosspost',
];

export interface MediaItem {
  src: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface MediaDescriptor {
  kind: 'image' | 'gallery' | 'video' | 'gif' | 'embed';
  items: MediaItem[];
  dashUrl?: string;
  mp4Url?: string;
  host: string;
}

export interface Flair {
  text: string;
}

export interface Post {
  kind: 'post';
  id: string;
  title: string;
  permalink: string;
  url: string | null;
  type: PostType;
  domain: string;
  author: string | null;
  subreddit: string;
  score: number | null;
  upvoteRatio: number | null;
  commentCount: number;
  created: Date | null;
  flair: Flair | null;
  nsfw: boolean;
  spoiler: boolean;
  /** Boolean attributes on the post (verified live 2026-10-15); absent on search results. */
  locked?: boolean;
  stickied?: boolean;
  thumbnail: string | null;
  media: MediaDescriptor | null;
  feedIndex: number | null;
  bodyHtml: string | null;
  source: Element;
}

export interface Comment {
  kind: 'comment';
  id: string;
  postId: string | null;
  parentId: string | null;
  depth: number;
  author: string | null;
  isOp: boolean;
  distinguished: 'moderator' | 'admin' | null;
  score: number | null;
  created: Date | null;
  bodyHtml: string;
  permalink: string | null;
  source: Element;
}

export interface CommentNode {
  comment: Comment;
  children: CommentNode[];
}

export interface ProfileComment {
  kind: 'profileComment';
  id: string;
  permalink: string;
  contextHref: string;
  subreddit: string | null;
  postTitle: string | null;
  created: Date | null;
  bodyHtml: string;
  source: Element;
}

export interface Session {
  signedIn: boolean;
  username: string | null;
}
