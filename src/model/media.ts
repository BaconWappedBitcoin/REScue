/**
 * Media descriptors for Reddit-hosted image/gallery/video/gif posts, plus DASH manifest parsing
 * and video/audio pairing.
 *
 * Ported from Sheddit src/core/model.js (mp4Of, expired, imageOf, framesOf, pictureKey,
 * thumbnailFor) and src/core/media.js (pickRendition, pair) — GPL-3.0, Copyright (C) 2026
 * kookaburrabarrel, commit cff40d7.
 */
import { C } from '../contracts/reddit';
import { ownQueryAll } from '../core/dom';
import type { MediaDescriptor, PostType } from './types';

const host = (u: string): string => (String(u).split('/')[2] ?? '').toLowerCase();
const absolutize = (u: string): string =>
  /^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/\//, '')}`;

const EXPIRY_SLOP_MS = 30_000;

/** Signed packaged-media URLs carry `e=<unix seconds>`; an expired one 403s like a codec fault. */
export function expired(url: string, now = Date.now()): boolean {
  const hit = /[?&]e=(\d+)(?:&|$)/.exec(url);
  if (!hit) return false;
  const at = Number(hit[1]) * 1000;
  return Number.isFinite(at) && at > 0 && at - EXPIRY_SLOP_MS <= now;
}

/** Best mp4 from the post's packaged-media JSON: tallest, non-VP9 preferred, unexpired. */
export function mp4Of(postEl: Element, now = Date.now()): string | null {
  try {
    const holder = [...postEl.querySelectorAll(`[${C.postVideoJson}]`)].find(
      (n) => n.closest(C.post) === postEl,
    );
    const raw = holder?.getAttribute(C.postVideoJson);
    if (!raw) return null;
    const found = new Map<string, number | null>();
    const stated = (o: unknown): number | null => {
      const hgt = (o as { dimensions?: { height?: unknown } } | null)?.dimensions?.height;
      return typeof hgt === 'number' && hgt > 0 ? hgt : null;
    };
    const walk = (v: unknown, parent: unknown) => {
      if (typeof v === 'string') {
        if (/^https:\/\/\S+\.mp4(\?|$)/i.test(v) && !found.has(v)) found.set(v, stated(parent));
      } else if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) walk((v as Record<string, unknown>)[k], v);
      }
    };
    walk(JSON.parse(raw), null);
    for (const url of [...found.keys()]) if (expired(url, now)) found.delete(url);
    if (!found.size) return null;
    const fileOf = (u: string) => u.split('?')[0]!.split('/').pop() ?? '';
    const rank = (u: string) => Math.max(0, ...(fileOf(u).match(/\d+/g) ?? ['0']).map(Number));
    return [...found]
      .map(([url, s], i) => ({ url, i, height: s ?? rank(url), vp9: /vp9/i.test(fileOf(url)) }))
      .sort((a, b) => b.height - a.height || Number(a.vp9) - Number(b.vp9) || a.i - b.i)[0]!.url;
  } catch {
    return null;
  }
}

interface Candidate {
  url: string;
  w: number;
  orig: boolean;
}

function candidates(img: HTMLImageElement): Candidate[] {
  const out: Candidate[] = [];
  const isOrig = (u: string) => C.originalHost.test(host(u));
  for (const part of (img.getAttribute('srcset') ?? '').split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    if (!url) continue;
    const w = /^(\d+)w$/.exec(size ?? '');
    out.push({ url, w: w ? parseInt(w[1]!, 10) : 0, orig: isOrig(url) });
  }
  const plain = img.getAttribute('src');
  if (plain) out.push({ url: absolutize(plain), w: 0, orig: isOrig(absolutize(plain)) });
  const lazy = img.getAttribute(C.galleryLazySrc);
  if (lazy) out.push({ url: lazy, w: 0, orig: isOrig(lazy) });
  return out;
}

function bestOf(img: HTMLImageElement): string | null {
  let best: string | null = null;
  let bestW = -1;
  let bestOrig = false;
  for (const c of candidates(img)) {
    if (!C.thumbHosts.test(host(c.url))) continue;
    const better = c.orig !== bestOrig ? c.orig : c.w > bestW;
    if (better) {
      best = c.url;
      bestW = c.w;
      bestOrig = c.orig;
    }
  }
  return best;
}

const ownImages = (postEl: Element) =>
  (ownQueryAll(postEl, 'img', C.post) as HTMLImageElement[]).filter(
    (i) => !i.closest(C.thumbExclude),
  );

/** Same picture at different sizes collapses to one key, so galleries list each image once. */
export function pictureKey(u: string): string {
  const h = host(u);
  const path = u.split('/').slice(3).join('/').split(/[?#]/)[0];
  return `${/(^|\.)redd\.it$/.test(h) ? 'redd.it' : h}/${path}`;
}

export function galleryImages(postEl: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const img of ownImages(postEl)) {
    const best = bestOf(img);
    if (!best || seen.has(pictureKey(best))) continue;
    seen.add(pictureKey(best));
    out.push(best);
  }
  return out;
}

export function imageOf(postEl: Element): string | null {
  return galleryImages(postEl)[0] ?? null;
}

export function thumbnailOf(postEl: Element, type: PostType): string | null {
  if (type === 'text') return null;
  for (const img of ownImages(postEl)) {
    for (const c of candidates(img)) if (C.thumbHosts.test(host(c.url))) return c.url;
  }
  return null;
}

export function dashBase(contentHref: string | null): string | null {
  const hit = C.videoAsset.exec(contentHref ?? '');
  return hit ? `https://v.redd.it/${hit[1]}` : null;
}

export function describeMedia(
  postEl: Element,
  type: PostType,
  contentHref: string | null,
): MediaDescriptor | null {
  if (type === 'image') {
    const src = imageOf(postEl);
    return src ? { kind: 'image', items: [{ src }], host: host(src) } : null;
  }
  if (type === 'gallery') {
    const items = galleryImages(postEl).map((src) => ({ src }));
    return items.length ? { kind: 'gallery', items, host: 'redd.it' } : null;
  }
  if (type === 'video') {
    const base = dashBase(contentHref);
    const mp4 = mp4Of(postEl);
    if (!base && !mp4) return null;
    return {
      kind: 'video',
      items: [],
      host: 'v.redd.it',
      ...(base ? { dashUrl: `${base}/${C.videoManifest}` } : {}),
      ...(mp4 ? { mp4Url: mp4 } : {}),
    };
  }
  return null;
}

export interface Rendition {
  url: string;
  width: number | null;
  height: number;
  audioUrl: string | null;
}

const BOX_WIDTH = 640;

/** Pick the smallest video rendition at least BOX_WIDTH wide (else the widest) plus best audio. */
export function pickRendition(manifestXml: string, base: string): Rendition | null {
  const doc = new DOMParser().parseFromString(manifestXml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const reps = [...doc.querySelectorAll('Representation')]
    .map((r) => {
      const set = r.closest('AdaptationSet');
      const mime = r.getAttribute('mimeType') ?? set?.getAttribute('mimeType') ?? '';
      const kind = set?.getAttribute('contentType') ?? mime.split('/')[0] ?? '';
      return {
        kind,
        file: (r.querySelector('BaseURL')?.textContent ?? '').trim(),
        height: Number(r.getAttribute('height')),
        width: Number(r.getAttribute('width')),
      };
    })
    .filter((r) => r.file);
  const video = reps.filter((r) => r.kind === 'video' && Number.isFinite(r.height) && r.height > 0);
  const audio = reps.filter((r) => r.kind === 'audio');
  if (!video.length) return null;
  const byWidth = [...video].sort((a, b) => (a.width || 0) - (b.width || 0));
  const best = byWidth.find((r) => (r.width || 0) >= BOX_WIDTH) ?? byWidth[byWidth.length - 1]!;
  const sound = audio[audio.length - 1];
  return {
    url: `${base}/${best.file}`,
    width: Number.isFinite(best.width) && best.width > 0 ? best.width : null,
    height: best.height,
    audioUrl: sound ? `${base}/${sound.file}` : null,
  };
}

const SYNC_SLOP = 0.12;

/** Keep a separate audio element in lockstep with a video element. Returns a disposer. */
export function pairAudio(video: HTMLVideoElement, audio: HTMLAudioElement): () => void {
  const ctl = new AbortController();
  const on = (type: string, fn: () => void) =>
    video.addEventListener(type, fn, { signal: ctl.signal });
  const align = () => {
    audio.currentTime = video.currentTime;
  };
  const resume = () => {
    if (!video.paused) audio.play().catch(() => {});
  };
  on('play', () => (align(), resume()));
  on('pause', () => audio.pause());
  on('seeking', align);
  on('ratechange', () => (audio.playbackRate = video.playbackRate));
  on('volumechange', () => {
    audio.volume = video.volume;
    audio.muted = video.muted;
  });
  on('waiting', () => audio.pause());
  on('playing', () => (align(), resume()));
  on('ended', () => audio.pause());
  on('timeupdate', () => {
    if (Math.abs(audio.currentTime - video.currentTime) > SYNC_SLOP) align();
  });
  audio.volume = video.volume;
  audio.muted = video.muted;
  return () => ctl.abort();
}
