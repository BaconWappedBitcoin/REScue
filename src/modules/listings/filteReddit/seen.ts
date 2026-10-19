/** What the filteReddit session remembers about each post and comment it has seen. */
import type { Comment, Post } from '../../../model/types';
import type { CommentAction } from './commentRules';
import type { Placeholder } from './ui';

export interface SeenPost {
  post: Post;
  button: HTMLButtonElement | null;
  chip: HTMLElement;
  /** The rule that matches this post, whether or not the power switch lets it act. */
  match: string | undefined;
  /** The rule that is acting on it now (match, while the switch is on). */
  reason: string | undefined;
  /** The reason currently handed to ui.hide, if any. */
  applied: string | undefined;
  holder: Placeholder | null;
  /** The reader opened this post from its placeholder. */
  peek: boolean;
}

export interface CommentEffect {
  reason: string;
  action: CommentAction;
}

export interface SeenComment {
  comment: Comment;
  /** Made when the comment is first filtered: a 5,000-comment thread should not pay for 5,000 chips. */
  chip: HTMLElement | null;
  match: CommentEffect | undefined;
  applied: CommentEffect | undefined;
}
