/**
 * Other modules can ask filteReddit to hide a post and say why. filteReddit then handles the rest
 * the way it does for its own rules: the hide, the "N posts filtered · show" banner, the reason
 * chip, the placeholder row, the power switch and the reveal. A provider only decides, per post,
 * whether there is a reason; it never touches the page.
 *
 * Providers are consulted after the reader's own rules, so a rule's reason wins when both apply.
 * The registry lives at module level so the order modules start in does not matter.
 */
import type { ModuleContext } from '../../../core/types';
import type { Post } from '../../../model/types';

/** A reason to hide `post`, or null/undefined to leave it alone. Must be cheap and synchronous. */
export type PostReasonProvider = (
  post: Post,
  ctx: ModuleContext,
) => string | { reason: string; detail: string } | null | undefined;

const providers = new Map<string, PostReasonProvider>();
const listeners = new Set<() => void>();

/** Register (or replace) the provider with this id. Returns a function that removes it. */
export function registerPostReasons(id: string, provider: PostReasonProvider): () => void {
  providers.set(id, provider);
  return () => {
    if (providers.get(id) === provider) providers.delete(id);
    changed();
  };
}

/** Longer explanations for the chip's tooltip, by post id; valid only for the reason stored with them. */
const details = new Map<string, { reason: string; detail: string }>();

/** The first provider's (short) reason for `post`, if any. A provider may add a longer `detail`. */
export function externalReason(post: Post, ctx: ModuleContext): string | undefined {
  details.delete(post.id);
  for (const provider of providers.values()) {
    const got = provider(post, ctx);
    if (!got) continue;
    if (typeof got === 'string') return got;
    details.set(post.id, got);
    return got.reason;
  }
  return undefined;
}

/** The provider's long explanation for this post's current `reason`, if it gave one. */
export function externalDetail(postId: string, reason: string | undefined): string | undefined {
  const d = details.get(postId);
  return d && d.reason === reason ? d.detail : undefined;
}

/** filteReddit listens here to re-evaluate every post it has seen. */
export function onExternalReasonsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A provider's answers changed (options edited, data loaded): ask for a fresh look at every post. */
export function changed(): void {
  for (const listener of listeners) listener();
}
