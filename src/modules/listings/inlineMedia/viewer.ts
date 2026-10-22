/**
 * mediaViewer (RES showImages sizing, filmstrip and original-resolution options, hosts vreddit and
 * link expandos, keyboardNav image keys): size, move and re-present the media Reddit shows inside
 * posts. It works on Reddit's own light-DOM media container (`div[slot=post-media-container]`)
 * through REScue's stylesheet and attributes on the post, and adds REScue-owned blocks INSIDE that
 * container (a gallery filmstrip, a plain video player). Nothing inside Reddit's shadow roots is
 * written. Every option is off or neutral by default, so Reddit's media looks as it always did
 * until you change one; Reddit's own gallery and player are hidden only while the matching option
 * is on, and each REScue block carries a word that brings Reddit's version back.
 *
 * Ported in spirit from RES lib/modules/showImages.js and hosts/vreddit.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 */
import { C } from '../../../contracts/reddit';
import { h, ownQueryAll } from '../../../core/dom';
import { hint } from '../../../core/hints';
import { jsonFor } from '../../../core/redditJson';
import { resolveOptions, setOption } from '../../../core/settings';
import { defineModule, type ModuleContext, type ModuleDefinition } from '../../../core/types';
import { MEDIA_ATTR, MEDIA_COLLAPSED, mediaContainerOf } from '../../../model/inline-media';
import type { Post } from '../../../model/types';
import { removeStyle, setStyle } from '../../appearance/injectedStyle';
import {
  buildFilmstrip,
  FILM_ATTR,
  FILM_CLASS,
  FILM_ON,
  filmCss,
  galleryPictures,
  positiveInt,
  wantsFilmstrip,
} from './filmstrip';
import { decorateLinks, removeLinkMedia } from './linkMedia';
import { OriginalSizes } from './originalSizes';
import { registerMediaKeys, setMediaKeyHost } from './mediaKeys';
import {
  buildPlayer,
  playableMp4,
  PLAYER_ATTR,
  PLAYER_CLASS,
  PLAYER_ON,
  playerCss,
} from './player';
import {
  parseLimit,
  pictureElements,
  ratioOf,
  RATIO_ATTR,
  resolutionOf,
  SIZE_ATTR,
  sizingCss,
  steppedWidth,
  VAR_DX,
  VAR_DY,
  VAR_RATIO,
  VAR_W,
  type SizeState,
  type SizingOptions,
} from './sizing';

const STYLE_ID = 'rescue-media-viewer-style';
const MAX_PX = 10000;

interface Opts extends SizingOptions {
  displayOriginalResolution: boolean;
  galleryAsFilmstrip: boolean;
  filmstripLoadIncrement: string;
  useSlideshowWhenLargerThan: string;
  replaceVideoPlayer: boolean;
  expandLinkMedia: boolean;
}

interface Rec {
  post: Post;
  size?: SizeState | undefined;
  film: HTMLElement | null;
  filmCount: number;
  /** You chose Reddit's slideshow for this post, whatever the option says. */
  filmOff: boolean;
  player: HTMLElement | null;
  playerMp4: string | null;
  playerOff: boolean;
  res: HTMLElement | null;
}

interface State {
  ctx: ModuleContext;
  recs: Map<string, Rec>;
  removeMenu: () => void;
  sizes: OriginalSizes;
}

let state: State | null = null;

const optsOf = (ctx: ModuleContext): Opts => ctx.options as unknown as Opts;
const styleText = (o: Opts): string =>
  [sizingCss(o), filmCss(), playerCss()].filter(Boolean).join('\n');

// --- size and position ---------------------------------------------------------------------------

const mediaShown = (rec: Rec): boolean =>
  rec.post.source.getAttribute(MEDIA_ATTR) !== MEDIA_COLLAPSED &&
  !!mediaContainerOf(rec.post.source);

function applySize(rec: Rec): void {
  const host = rec.post.source as HTMLElement;
  const size = rec.size;
  if (!size) {
    host.removeAttribute(SIZE_ATTR);
    for (const v of [VAR_W, VAR_DX, VAR_DY]) host.style.removeProperty(v);
    return;
  }
  host.setAttribute(SIZE_ATTR, '');
  host.style.setProperty(VAR_W, size.width === 'fit' ? '100%' : `${size.width}px`);
  host.style.setProperty(VAR_DX, `${size.dx}px`);
  host.style.setProperty(VAR_DY, `${size.dy}px`);
}

/** Pictures that have not loaded yet get one look when they do (their size is not known before). */
function watchPictures(rec: Rec, box: Element | null): void {
  for (const img of pictureElements(box)) {
    if (img.naturalWidth > 0 || watched.has(img)) continue;
    watched.add(img);
    img.addEventListener(
      'load',
      () => {
        if (state?.recs.get(rec.post.id) === rec) sync(rec, optsNow());
      },
      { once: true },
    );
  }
}
const watched = new WeakSet<Element>();

function applyRatio(rec: Rec): void {
  const host = rec.post.source as HTMLElement;
  const box = mediaContainerOf(host);
  watchPictures(rec, box);
  const ratio = ratioOf(rec.post, box);
  if (ratio) {
    host.setAttribute(RATIO_ATTR, '');
    host.style.setProperty(VAR_RATIO, String(Math.round(ratio * 10000) / 10000));
  } else {
    host.removeAttribute(RATIO_ATTR);
    host.style.removeProperty(VAR_RATIO);
  }
}

function currentWidth(rec: Rec): number {
  if (typeof rec.size?.width === 'number') return rec.size.width;
  const box = mediaContainerOf(rec.post.source);
  return Math.round(box?.getBoundingClientRect().width || 480);
}

function selectedRec(): Rec | undefined {
  const item = state?.ctx.ui.selection().current();
  return item?.kind === 'post' ? state?.recs.get(item.id) : undefined;
}

function startKeys(ctx: ModuleContext): void {
  registerMediaKeys(ctx.keys);
  setMediaKeyHost({
    ready: () => {
      const rec = selectedRec();
      return !!rec && mediaShown(rec);
    },
    resize(factor) {
      const rec = selectedRec();
      if (!rec) return;
      const width = Math.min(MAX_PX, steppedWidth(currentWidth(rec), factor));
      rec.size = { width, dx: rec.size?.dx ?? 0, dy: rec.size?.dy ?? 0 };
      applySize(rec);
    },
    fit() {
      const rec = selectedRec();
      if (!rec) return;
      rec.size = rec.size?.width === 'fit' ? undefined : { width: 'fit', dx: 0, dy: 0 };
      applySize(rec);
    },
    move(dx, dy) {
      const rec = selectedRec();
      if (!rec) return;
      const width = rec.size?.width ?? currentWidth(rec);
      rec.size = { width, dx: (rec.size?.dx ?? 0) + dx, dy: (rec.size?.dy ?? 0) + dy };
      applySize(rec);
    },
  });
}

// --- filmstrip, player, resolution ---------------------------------------------------------------

function dropFilm(rec: Rec): void {
  rec.film?.remove();
  rec.film = null;
  rec.post.source.removeAttribute(FILM_ATTR);
}

function syncFilm(rec: Rec, o: Opts): void {
  const items = galleryPictures(rec.post);
  const box = mediaContainerOf(rec.post.source);
  const want =
    !!box &&
    !rec.filmOff &&
    wantsFilmstrip(
      o.galleryAsFilmstrip,
      items.length,
      positiveInt(o.useSlideshowWhenLargerThan, 0),
    );
  if (!want || !box) return dropFilm(rec);
  if (!rec.film?.isConnected || rec.filmCount !== items.length) {
    rec.film?.remove();
    rec.film = buildFilmstrip(items, positiveInt(o.filmstripLoadIncrement, 30), () => {
      rec.filmOff = true;
      syncFilm(rec, optsNow());
    });
    rec.filmCount = items.length;
    box.append(rec.film);
  }
  rec.post.source.setAttribute(FILM_ATTR, FILM_ON);
}

function dropPlayer(rec: Rec): void {
  rec.player?.querySelector('video')?.pause();
  rec.player?.remove();
  rec.player = null;
  rec.post.source.removeAttribute(PLAYER_ATTR);
}

function syncPlayer(rec: Rec, o: Opts): void {
  const box = mediaContainerOf(rec.post.source);
  const mp4 = o.replaceVideoPlayer && !rec.playerOff ? playableMp4(rec.post) : null;
  if (!mp4 || !box) return dropPlayer(rec);
  if (!rec.player?.isConnected || rec.playerMp4 !== mp4) {
    rec.player?.remove();
    rec.player = buildPlayer(mp4, () => {
      rec.playerOff = true;
      syncPlayer(rec, optsNow());
    });
    rec.playerMp4 = mp4;
    box.append(rec.player);
  }
  rec.post.source.setAttribute(PLAYER_ATTR, PLAYER_ON);
}

function syncResolution(rec: Rec, o: Opts): void {
  if (!rec.res) return;
  // The original size comes from Reddit's thread JSON (originalSizes.ts), asked only while the
  // option is on.
  if (o.displayOriginalResolution) state?.sizes.want(rec.post.id);
  const text = o.displayOriginalResolution
    ? resolutionOf(
        rec.post,
        mediaContainerOf(rec.post.source),
        state?.sizes.get(rec.post.id) ?? null,
      )
    : null;
  rec.res.textContent = text ?? '';
  rec.res.hidden = !text;
}

function optsNow(): Opts {
  return state ? optsOf(state.ctx) : ({} as Opts);
}

function sync(rec: Rec, o: Opts): void {
  applyRatio(rec);
  syncFilm(rec, o);
  syncPlayer(rec, o);
  syncResolution(rec, o);
}

function clean(rec: Rec): void {
  rec.size = undefined;
  applySize(rec);
  dropFilm(rec);
  dropPlayer(rec);
  rec.res?.remove();
  const host = rec.post.source as HTMLElement;
  host.removeAttribute(RATIO_ATTR);
  host.style.removeProperty(VAR_RATIO);
}

// --- link expandos -------------------------------------------------------------------------------

function expandLinks(batchPosts: Post[], comments: Array<{ source: Element }>, o: Opts): void {
  if (!o.expandLinkMedia) return;
  const maxHeight = parseLimit(o.maxHeight, 'h');
  for (const p of batchPosts) {
    const body = ownQueryAll(p.source, C.postBody, C.post)[0];
    if (body) decorateLinks(body, maxHeight);
  }
  for (const c of comments) {
    const body = ownQueryAll(c.source, C.commentBody, C.comment)[0];
    if (body) decorateLinks(body, maxHeight);
  }
}

// --- the module ---------------------------------------------------------------------------------

const filmOn = (s: State): boolean =>
  resolveOptions(mediaViewer as ModuleDefinition, s.ctx.settings.profile()).galleryAsFilmstrip ===
  true;

function setFilm(s: State, on: boolean): void {
  const def = mediaViewer as ModuleDefinition;
  void s.ctx.settings
    .save(setOption(s.ctx.settings.profile(), def, 'galleryAsFilmstrip', on))
    .catch(() => s.ctx.notices.show('REScue could not save that change.', { kind: 'error' }));
}

export const mediaViewer = defineModule({
  id: 'mediaViewer',
  resId: 'showImages',
  category: 'listings',
  title: 'Media viewer: sizes, gallery filmstrip, video player',
  description:
    'Limit how wide or tall pictures and video are shown, cap long self-text and comments with a scroll bar, stack a gallery’s pictures down the page, play videos in a plain player, and expand picture links in comments. Select a post and press = / - (larger / smaller), + / _ (a little), Shift+Right (fit to width), Ctrl+arrows (move) to size and move its media. All off by default; Reddit’s own gallery and player come back with a word under each REScue replacement. Only Reddit’s media container is styled; nothing inside it is touched.',
  enabledByDefault: true,
  options: {
    maxWidth: {
      type: 'text',
      default: '100%',
      title: 'Widest media',
      description:
        'Limit the width of pictures and video: 600, 600px or 50% of the column. 100% leaves Reddit’s size.',
    },
    maxHeight: {
      type: 'text',
      default: '0',
      title: 'Tallest media',
      description:
        'Limit the height of pictures and video whose size Reddit gives: 500px or 80% of the window. 0 leaves Reddit’s size. (RES used 80%.)',
    },
    displayOriginalResolution: {
      type: 'boolean',
      default: false,
      title: 'Show the original size of pictures',
      description:
        'Add the picture’s original size in pixels (for example “1920 × 1080”) after the time. Reddit only loads a smaller preview, so REScue asks Reddit for the size, in one read-only request for the posts on the page (nothing is downloaded or posted).',
    },
    selfTextMaxHeight: {
      type: 'text',
      default: '0',
      title: 'Tallest post text',
      description:
        'Give long post text a scroll bar above this height: 400px or 50% of the window. 0 for no limit.',
    },
    commentMaxHeight: {
      type: 'text',
      default: '0',
      title: 'Tallest comment',
      description: 'Give long comments a scroll bar above this height. 0 for no limit.',
    },
    autoMaxHeight: {
      type: 'boolean',
      default: false,
      title: 'Choose a text height automatically',
      description:
        'Where the two limits above are 0, cap post text and comments at 80% of the window.',
    },
    galleryAsFilmstrip: {
      type: 'boolean',
      default: false,
      title: 'Stack galleries as a filmstrip',
      description:
        'Show a gallery’s pictures one under the other instead of Reddit’s one-at-a-time slideshow. Only the pictures Reddit has loaded are listed. Each filmstrip has a “show slideshow” word. Also in the REScue menu.',
    },
    filmstripLoadIncrement: {
      type: 'text',
      default: '30',
      title: 'Pictures per load',
      description: 'How many pictures a filmstrip draws at first and with each “load more”.',
      dependsOn: 'galleryAsFilmstrip',
    },
    useSlideshowWhenLargerThan: {
      type: 'text',
      default: '0',
      title: 'Use the slideshow above',
      description:
        'Galleries with more pictures than this keep Reddit’s slideshow instead of the filmstrip. 0 stacks every gallery.',
      dependsOn: 'galleryAsFilmstrip',
    },
    replaceVideoPlayer: {
      type: 'boolean',
      default: false,
      title: 'Play videos in a plain player',
      description:
        'Replace Reddit’s video player by a simple one (play, seek, volume, no autoplay) where Reddit gives the video file. A “show Reddit’s player” word brings Reddit’s back.',
    },
    expandLinkMedia: {
      type: 'boolean',
      default: false,
      title: 'Expand picture links in comments and post text',
      description:
        'Add “show picture” after links to pictures on Reddit’s own picture servers (i.redd.it, preview.redd.it). Nothing loads until you click. Links to other sites stay plain links.',
    },
  },

  init(ctx) {
    const sizes = new OriginalSizes(jsonFor(ctx.notices, 'mediaViewer'), () => {
      for (const rec of state?.recs.values() ?? []) syncResolution(rec, optsNow());
    });
    const s: State = { ctx, recs: new Map(), removeMenu: () => {}, sizes };
    state = s;
    setStyle(STYLE_ID, styleText(optsOf(ctx)));
    s.removeMenu = ctx.ui.addMenuItem({
      id: 'mediaViewer:filmstrip',
      label: 'Stack galleries',
      order: 42,
      hint: () => hint.menuFilmstrip(filmOn(s)),
      onClick: () => {},
      toggle: { get: () => filmOn(s), set: (on) => setFilm(s, on) },
    });
    startKeys(ctx);
  },

  onItems(batch, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    const o = optsOf(ctx);
    for (const p of batch.posts) {
      const known = s.recs.get(p.id);
      if (known) {
        known.post = p;
        sync(known, o);
        continue;
      }
      if (!p.media && !mediaContainerOf(p.source)) continue;
      const rec: Rec = {
        post: p,
        film: null,
        filmCount: 0,
        filmOff: false,
        player: null,
        playerMp4: null,
        playerOff: false,
        res: null,
      };
      if (p.media?.kind === 'image') {
        rec.res = h('span', {
          class: 'rescue-media-resolution rescue-label',
          title: hint.resolution,
        });
        rec.res.hidden = true;
        ctx.ui.decorate(p, 'tagline', rec.res);
      }
      s.recs.set(p.id, rec);
      sync(rec, o);
    }
    expandLinks(batch.posts, batch.comments, o);
  },

  onRoute(_route, ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    for (const rec of s.recs.values()) clean(rec);
    s.recs.clear();
  },

  onSettings(ctx) {
    const s = state;
    if (!s) return;
    s.ctx = ctx;
    const o = optsOf(ctx);
    setStyle(STYLE_ID, styleText(o));
    for (const rec of s.recs.values()) {
      // A change to the option starts again from it, not from earlier choices on this page.
      rec.filmOff = false;
      rec.playerOff = false;
      sync(rec, o);
    }
    if (!o.expandLinkMedia) removeLinkMedia();
  },

  dispose() {
    const s = state;
    state = null;
    setMediaKeyHost(null);
    if (!s) return;
    for (const rec of s.recs.values()) clean(rec);
    s.recs.clear();
    s.removeMenu();
    s.sizes.dispose();
    removeLinkMedia();
    removeStyle(STYLE_ID);
    for (const n of document.querySelectorAll(`.${FILM_CLASS}, .${PLAYER_CLASS}`)) n.remove();
  },
});
