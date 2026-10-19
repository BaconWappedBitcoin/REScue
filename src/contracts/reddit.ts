/**
 * contracts/reddit.ts — THE SINGLE POINT OF BREAKAGE (constitution Principle I).
 *
 * Every selector, tag name, attribute name, header value and endpoint path that Reddit owns lives
 * here and nowhere else. Feature modules never import this file; src/model/ and src/core/ do.
 *
 * Ported from Sheddit src/config/contracts.js (GPL-3.0, Copyright (C) 2026 kookaburrabarrel),
 * commit cff40d7. Inherited entries were verified live by Sheddit 2026-08/09; "verified" entries
 * were measured by REScue research (specs/001-rescue-foundation/research.md) on 2026-10-15.
 */

export type ContractStatus = 'verified' | 'inherited' | 'candidate';
export type ContractKind = 'selector' | 'attribute' | 'endpoint' | 'header' | 'text-pattern';
export type Host = 'www' | 'sh';

export interface PageContract {
  key: string;
  kind: ContractKind;
  value: string | RegExp;
  /** Absence marks dependent modules degraded/disabled. */
  required: boolean;
  hosts?: Host[];
  verifiedAt?: string;
  status: ContractStatus;
  usedBy: string[] | 'core';
}

/** Selector and attribute values, grouped for ergonomic use by src/model and src/core. */
export const C = {
  app: 'shreddit-app',
  main: '#main-content',
  // --- theme (VERIFIED LIVE 2026-10-15) ---------------------------------------------------------
  // Dark mode is the class `theme-dark` on <html> (`html.theme-beta.theme-dark`, computed
  // `color-scheme: dark`); light is `html.theme-beta` alone (`color-scheme: light`).
  themeDarkClass: 'theme-dark',
  // --- end theme ---------------------------------------------------------------------------------
  rightSidebar: '#right-sidebar-container',
  header: 'reddit-header-large',
  leftNav: 'reddit-sidebar-nav, #left-sidebar-container, nav#left-sidebar',

  feed: 'shreddit-feed',
  post: 'shreddit-post',
  postWrapper: 'article',
  adPost: 'shreddit-ad-post',
  feedEmpty: '[data-testid="no-content"]',
  profileHidden: /\blikes to keep\b[\s\S]{0,40}?\bhidden\b/i,

  partial: 'faceplate-partial',
  partialNotSrc: 'hover-card',
  /**
   * The feed's own next-page loader: the one direct child of the feed in the `load-after` slot
   * (verified live 2026-10-16 on www./sh., subreddit, home, popular and profile feeds; the old
   * `programmatic` selector matched ~29 unrelated partials such as per-post menus and modals).
   */
  feedPartial: 'shreddit-feed > faceplate-partial[slot="load-after"]',
  /** Reddit finds the subreddit/profile loader by this id prefix (a post or sentinel loads it). */
  feedPartialIdPrefix: 'partial-more-posts-',
  commentPartial: 'shreddit-comment-tree faceplate-partial[loading="programmatic"]',
  partialLoadMethod: 'loadContent',
  moreRepliesText: /more repl/i,
  /**
   * CANDIDATE (neverEndingComments / keyboardNav loadChildComments): the reader's OWN "N more
   * replies" control inside a comment's subtree. No such control was present on the probed thread
   * (2026-10-16), so it is found by its words and fails safe: no match, nothing is clicked.
   */
  moreRepliesControl: 'button, a, [role="button"]',
  moreRepliesLabel: /^\s*\d+\s+more repl(?:y|ies)\s*$/i,

  postAttr: {
    id: 'id',
    title: 'post-title',
    permalink: 'permalink',
    contentHref: 'content-href',
    type: 'post-type',
    score: 'score',
    upvoteRatio: 'upvote-ratio',
    comments: 'comment-count',
    created: 'created-timestamp',
    domain: 'domain',
    author: 'author',
    subreddit: 'subreddit-name',
    subredditPrefixed: 'subreddit-prefixed-name',
    index: 'feedindex',
  },
  nsfwAttrs: ['nsfw'],
  spoilerAttrs: ['spoiler'],
  postBody: '[slot="text-body"]',
  postFlair: 'shreddit-post-flair',
  postRemovedText: /th(?:is|e) (?:post|submission|comment) was (?:deleted|removed)/i,
  postVideoJson: 'packaged-media-json',
  gifPlayer: 'shreddit-player[gif]',
  galleryLazySrc: 'data-lazy-src',
  thumbHosts: /^((preview|i|external-preview)\.redd\.it|[a-z]\.thumbs\.redditmedia\.com)$/,
  thumbExclude: 'shreddit-post-flair, faceplate-hovercard, shreddit-join-button, a[href^="/user/"]',
  originalHost: /^i\.redd\.it$/,
  videoAsset: /^https?:\/\/v\.redd\.it\/([A-Za-z0-9_-]+)/,
  videoManifest: 'DASHPlaylist.mpd',

  commentTree: 'shreddit-comment-tree',
  comment: 'shreddit-comment',
  commentAttr: {
    id: 'thingid',
    postId: 'postid',
    author: 'author',
    score: 'score',
    created: 'created',
    depth: 'depth',
    position: 'comment-position',
    parentPositions: 'comment-parent-positions',
    permalink: 'permalink',
  },
  commentBody: '[slot="comment"]',
  commentScoreHidden: 'score-hidden',
  /** The vertical thread line inside a comment, LIGHT DOM (commentQuickCollapse, verified 2026-10-16). */
  commentThreadline: 'div.threadline-strip',
  /**
   * CANDIDATE: the brief records a `collapsed` attribute on <shreddit-comment> (2026-10-16), but
   * REScue's own 2026-10-15 capture found no collapse state on the element (only <details>.open).
   * Kept a candidate so the collapsed thread-line colour fails safe if the attribute never appears.
   */
  commentCollapsedAttr: 'collapsed',
  /**
   * VERIFIED LIVE 2026-10-15 (www., logged out): Reddit collapses a comment with a light-DOM
   * <details> that belongs to the comment, whose <summary> holds the meta line. Its `open` state
   * IS the collapse state (clicking the summary closes it and the replies drop to zero height).
   * The `collapsed` attribute is NOT used. The comment's shadow root is closed. `toggle` does
   * not bubble, so observers listen in the capture phase.
   */
  commentDetails: 'details',
  commentSummary: 'summary',
  /**
   * CANDIDATE (US6 commentSortBy): light-DOM links to a thread inside a post
   * element (the title link; links inside the post's shadow root are out of reach by design).
   */
  threadLink: 'a[href*="/comments/"]',
  /** Candidate (research R7): unverified; null distinguished until a live capture confirms. */
  /**
   * Boolean (presence) attributes on <shreddit-comment>. Moderator VERIFIED LIVE 2026-10-15 on an
   * AutoModerator comment in r/science (absent on an ordinary comment in the same thread). Admin
   * follows the same pattern but is UNVERIFIED: presence-only, so if Reddit never emits it no
   * comment is ever mislabelled (research R7).
   */
  commentDistinguished: { moderator: 'is-mod-distinguished', admin: 'is-admin-distinguished' },

  /**
   * Native decoration anchors, VERIFIED LIVE 2026-10-15 (light DOM, www. and sh.). On listings the
   * post's shadow root has NO `credit-bar` / `title` slots (Reddit's own elements sit inside a
   * wrapper), so elements slotted onto the post never render there. What renders without
   * reflowing Reddit's layout: post author nodes after the `[slot=authorName]` wrapper (the link
   * itself sits in a block-level tracker, so nodes after it wrap to a new line); post tagline
   * nodes after the credit bar's `faceplate-timeago` (the credit bar is a two-group
   * justify-between row); comment nodes after the author link / inside the `commentMeta` element.
   *
   * Two credit-bar designs are live (both verified 2026-10-15): logged-out listings and thread pages
   * wrap the author in `[slot=authorName]`; signed-in listings have no wrapper — the credit bar
   * holds an avatar link (no text) and the name link inside an `li` of a flex `ul`. So the post's
   * author link is the first `/user/` link in its own credit bar WITH visible text, and author
   * nodes go after the authorName wrapper if there is one, else at the end of the author's `li`.
   */
  postAuthorLink: '[slot="credit-bar"] a[href*="/user/"]',
  postAuthorItem: 'li',
  /** The post's relative time inside its credit bar. */
  postTime: 'faceplate-timeago',
  /** Relative to a comment's own meta slot (never a nested child comment's). */
  commentAuthorLink: 'a[href*="/user/"]',
  slots: {
    postCredit: 'credit-bar',
    postTitle: 'title',
    postAuthorName: 'authorName',
    commentMeta: 'commentMeta',
  },
  slotAttr: 'slot',

  /**
   * Inline media container (inlineMedia), VERIFIED LIVE 2026-10-15 (research R20, www. and sh.):
   * on listings AND thread pages all of a post's inline media (images, galleries, video, embeds)
   * sits in this light-DOM child of the post. REScue only sets display:none on the container (via
   * an attribute on the post and its own stylesheet); it never touches what is inside it.
   */
  mediaContainer: 'div[slot="post-media-container"]',
  /** What the container holds, for naming the media type when the post model has no answer. */
  mediaInner: {
    gallery: 'gallery-carousel',
    video: 'shreddit-player',
    embed: 'shreddit-embed',
  },
  /**
   * Media inside a COMMENT body (inlineMedia, "Hide inline media"), VERIFIED LIVE 2026-10-16
   * (www., signed in; r/law, r/pics, r/memes threads). The body is the light-DOM
   * `div[slot=comment]` (a descendant, not a child, of `shreddit-comment`, which has no shadow
   * root). Every picture, GIF and video in it sits in a `figure.rte-media`:
   *   image  figure.rte-media > a > img[alt="Comment Image"]
   *   GIF    figure.rte-media > div > a > div > shreddit-async-loader > shreddit-player[gif]
   *   video  figure.rte-media > div.rte-video-placeholder > … > shreddit-player[player-type=comment_player]
   * The `shreddit-player` has an open shadow root holding the `<video>`; REScue never enters it.
   * The whole `[slot=comment]` content can be wrapped in a `shreddit-async-loader` and is built
   * lazily, so figures appear after the comment itself. No emoji/sticker `img` outside a figure
   * was seen. REScue hides the figure as a whole (display:none, attribute keyed) and adds its own
   * button before it.
   */
  commentMedia: {
    figure: 'figure.rte-media',
    /** A GIF is a looping `shreddit-player` carrying this attribute. */
    gif: 'shreddit-player[gif]',
    video: 'shreddit-player',
    image: 'img',
  },
  /** Hosts whose downloads opt-in blocking stops (declarativeNetRequest, `*.redd.it`). */
  mediaHosts: [
    'preview.redd.it',
    'external-preview.redd.it',
    'i.redd.it',
    'v.redd.it',
    'packaged-media.redd.it',
  ],
  mediaInitiator: 'reddit.com',

  profileComment: 'shreddit-profile-comment',
  profileCommentAttr: { id: 'comment-id', href: 'href' },
  profileCommentBody: '[slot="comment"], .md',
  profileCommentSubLink: 'a[href^="/r/"]',
  profileCommentPostLink: 'a[href*="/comments/"]',

  session: {
    loggedIn:
      'shreddit-app[user-logged-in="true"], #expand-user-drawer-button, ' +
      'reddit-header-large [id*="user-drawer" i]',
    loggedOut: 'reddit-header-large a[href*="/login"], faceplate-tracker[noun="login"]',
    usernameAttrSel: 'shreddit-app > after-login-toast-dispatcher[username]',
    usernameAttr: 'username',
    loggedInAttr: 'user-logged-in',
    usernameLinks:
      'reddit-header-large a[href*="/user/"], #expand-user-drawer-button a[href*="/user/"], ' +
      'user-drawer-app a[href*="/user/"], [id*="user-drawer" i] a[href*="/user/"]',
  },

  /**
   * Timestamps (US8 localDate). The post's `faceplate-timeago` (C.postTime, VERIFIED as an anchor)
   * carries the time in `ts`, or in an inner <time datetime>; both are CANDIDATES until a live
   * capture confirms them, so the model's own created attribute (verified) is the fallback. A
   * comment's time is looked for inside its own commentMeta (CANDIDATE).
   */
  time: {
    tsAttr: 'ts',
    inner: 'time',
    datetimeAttr: 'datetime',
    commentTime: 'faceplate-timeago, time',
  },

  /**
   * Page chrome REScue may reach in the LIGHT DOM (US8). logoLink (`a#reddit-logo`), searchForm,
   * searchInput and chatEntry were VERIFIED live on 2026-10-15 (signed in, www.; the header's own
   * shadow root is open, but these nodes are light DOM). The rest are CANDIDATES, so a module that
   * uses one does nothing when it matches nothing. Nothing here pierces a shadow root; if
   * Reddit keeps one of these inside a closed shadow root the module is simply inert.
   */
  chrome: {
    logoLink:
      'reddit-header-large a#reddit-logo, reddit-header-large a[href="/"], ' +
      'reddit-header-large a[aria-label*="home" i]',
    searchForm: 'reddit-header-large form[action*="search" i], reddit-search-large form',
    searchInput: 'input[name="q"]',
    // Live 2026-10-15 (signed in, www.): the header's chat button, its unread badge and the chat
    // panel are these three ids in the light DOM. Exact ids only — a broad [id*="chat"] also
    // matched unrelated nodes.
    chatEntry:
      '#header-action-item-chat-button, #header-action-item-chat-button-badge, #reddit-chat',
    userMenu: 'reddit-header-large, user-drawer-app, [id*="user-drawer" i]',
    visitedLinks: 'shreddit-post a[href*="/comments/"]:visited',
    topLevelComment: 'shreddit-comment[depth="0"]',
    // Gap build H1 (T146), CANDIDATE: the post's title slot in the light DOM (R17 saw it).
    postTitle: 'shreddit-post [slot="title"]',
  },

  /**
   * COMMENT ACTIONS, VERIFIED LIVE 2026-10-15 (research R20, signed in, www.). `shreddit-comment`
   * has NO shadow root. Its controls are in the light-DOM child `shreddit-comment-action-row`
   * (slot=actionRow), which carries `vote-state` (seen: NONE; UP and DOWN not yet observed live,
   * so the values are matched loosely), `score`, `comment-id`, `author-name`, `comment-depth`
   * and `is-score-hidden`. The row has an OPEN shadow root with `button[upvote]` /
   * `button[downvote]` (aria-pressed). Rows hydrate lazily as a comment nears the viewport. A
   * row belongs to a comment only when `row.closest(comment) === comment` (replies nest).
   * Reply is a light-DOM button. Edit (own comments only) is an item of the row's
   * `shreddit-overflow-menu` (open root, `[role=menuitem]`), opened by `button#overflow-trigger`;
   * the item is found by its TEXT, a text-pattern contract that fails safe: no match, no click.
   */
  commentActions: {
    row: 'shreddit-comment-action-row[slot="actionRow"]',
    voteStateAttr: 'vote-state',
    voteStateUp: /^up(?:vote[d]?)?$/i,
    voteStateDown: /^down(?:vote[d]?)?$/i,
    voteStateNone: /^(?:none|null|)$/i,
    scoreAttr: 'score',
    scoreHiddenAttr: 'is-score-hidden',
    idAttr: 'comment-id',
    authorAttr: 'author-name',
    depthAttr: 'comment-depth',
    replyButton: 'faceplate-tracker[slot="comment-reply"] > button',
    overflowMenu: 'shreddit-overflow-menu[slot="overflow"]',
    overflowTrigger: 'button#overflow-trigger',
    menuItem: '[role="menuitem"]',
    /** Presence on the overflow menu: the signed-in user may edit this comment. */
    editableAttrs: ['editable-comment', 'is-comment-author'],
    editItemText: /^\s*edit(?:\s+comment)?\s*$/i,
  },
  /**
   * Save / hide through Reddit's OWN overflow menu (Save/Hide keys and hide links). Recorded live
   * read-only 2026-10-16 (signed in, www.): a post has `shreddit-post-overflow-menu` in its light
   * DOM with an OPEN shadow root whose rows are `li[role="presentation"]` ("Follow post", "Save",
   * "Hide", ...); a comment's menu is C.commentActions.overflowMenu, opened with
   * C.commentActions.overflowTrigger, its rows `[role="menuitem"]`. Rows are found by their TEXT, a
   * text-pattern contract that fails safe: no match on the wanted word, nothing is clicked.
   * VERIFIED LIVE 2026-10-16 (signed in, post menu): a saved post's row reads "Remove from saved",
   * a hidden post's "Remove from hidden" ("Unsave" / "Unhide" kept as fallbacks). A text that
   * matches neither state is never clicked. Post-menu rows are li[role=presentation] wrapping the
   * real div[role=menuitem]; the bridge clicks the inner menuitem (clicking the li does nothing).
   */
  saveHide: {
    postMenu: 'shreddit-post-overflow-menu',
    /** The button that opens a menu, inside its open shadow root (comments use overflowTrigger). */
    trigger: 'button#overflow-trigger, button[aria-haspopup], button[aria-expanded]',
    /** Fallback when no trigger carries a marker (the first button in the open root). */
    triggerFallback: 'button',
    /** A menu row: the post menu uses li[role=presentation]; a comment menu [role=menuitem]. */
    item: 'li[role="presentation"], [role="menuitem"]',
    saveText: /^\s*(?:save|unsave|remove from saved)\s*$/i,
    saveOnText: /^\s*(?:unsave|remove from saved)\s*$/i,
    hideText: /^\s*(?:hide|unhide|remove from hidden)\s*$/i,
    hideOnText: /^\s*(?:unhide|remove from hidden)\s*$/i,
    /** The Report row of a post's or comment's menu (opens Reddit's own report dialog). */
    reportText: /^\s*report(?:\s+(?:post|comment))?\s*$/i,
  },
  /** Boolean attributes on a post, VERIFIED LIVE 2026-10-15 (R20). */
  postFlagAttrs: { locked: 'locked', stickied: 'stickied' },
  /**
   * Old Reddit look (oldRedditSkin, research R23). VERIFIED LIVE 2026-10-18 (www., signed in,
   * Chromium 156; r/science, r/popular, home, search, a 800-comment thread). Everything here is
   * LIGHT DOM that a stylesheet may restyle; nothing reaches a shadow root. Reddit's palette is a
   * set of custom properties (`--color-neutral-*`, `--color-button-*`, `--color-upvote-*`,
   * `--size-button-sm-h`, `--shreddit-content-background`) declared on `:root`, `.grid-container`,
   * `.sidebar-grid` and `.stickied`; they inherit into the post's shadow tree, so setting them is
   * how the vote pills are restyled. The page is `.grid-container` > `#left-sidebar-container` +
   * `#subgrid-container` (> `.masthead`, `.main-container` > `main#main-content` +
   * `#right-sidebar-container`).
   *
   * A feed post (`shreddit-feed > article > shreddit-post`, open shadow root, no ::part exposed)
   * has two light-DOM shapes. Shape A (slim card, `is-slim-card`): one wrapper div holding a
   * credit-bar wrapper, a content wrapper (title, flair, link) and a thumbnail wrapper. Shape B
   * (large card): the credit bar, title wrapper, flair and `post-media-container` are siblings.
   * The vote pill, comments pill and share button live in the shadow root's action row, which is
   * a flat-tree child of the post: it can be placed by the post's own grid (as an auto-placed
   * item) but not restyled except through the custom properties above. Comments
   * (`shreddit-comment`) have NO shadow root; their action row has one.
   */
  skin: {
    pageBody: 'body',
    /** The custom property Reddit paints the content background with. */
    contentBackgroundVar: '--shreddit-content-background',
    /** Reddit's loader and repost-dropdown elements, direct children of a post (placeholders in the post's grid). */
    loader: 'faceplate-loader',
    dropdown: 'rpl-dropdown',
    pageGrid: '.grid-container',
    subGrid: '#subgrid-container',
    mainGrid: '.main-container',
    /** A subreddit feed's header. The search page's tab bar is a `.masthead` too, so the class is narrowed. */
    masthead: '.masthead.subreddit-feed-masthead',
    mastheadBanner: '.masthead.subreddit-feed-masthead > div:first-child',
    mastheadBar: '.masthead.subreddit-feed-masthead section',
    mastheadIcon:
      '.masthead.subreddit-feed-masthead section > div > div:first-child > div:first-child',
    sidebarBox: '#right-sidebar-container aside',
    /** Reddit's feed sort dropdown ("Best"); the comment sort dropdown has a different sort-event. */
    feedSort: 'shreddit-sort-dropdown[sort-event="feed-sort-change"]',
    /**
     * REScue's own marker on the skin's replacement elements (author link, title link, end of the
     * tagline); the adapter places decorations after them while the skin is on.
     */
    anchorAttr: 'data-rescue-anchor',
    /** REScue's own mark on a post / comment whose replacement rows are mounted (the CSS keys on it). */
    mountAttr: 'data-rescue-ov',
    /**
     * Where REScue's own pieces of a post go when the post's shadow root has no default slot
     * (feed posts in Firefox, VERIFIED LIVE 2026-10-18: only "full-post-link" and
     * "post-insights-panel" sit at the top of the shadow root). A light-DOM child without a slot is
     * not drawn at all there; one given a top-level slot is drawn as an item of the post's own grid.
     * Tried in this order; the first that is a top-level slot of the shadow root wins.
     */
    hostSlots: ['post-insights-panel', 'full-post-link'],
    /**
     * A feed post's video player. VERIFIED LIVE 2026-10-19 (r/popular, r/ClaudeAI, LibreWolf): a
     * light-DOM `shreddit-player` (inside `shreddit-async-loader`) with `poster`, `autoplay` and
     * `autoplay-pref` attributes. Under the Old Reddit look it is out of sight but still counted as
     * on screen, so Reddit autoplays it (with sound for the owner); the skin hides it entirely.
     */
    videoPlayer: 'shreddit-player',
    videoPoster: 'poster',
    /** The attribute on Reddit's feed sort dropdown while REScue's tabs stand in for it. */
    tabsAttr: 'data-rescue-tabs',
    /**
     * Reddit's create-post control. VERIFIED LIVE 2026-10-19 (r/news, LibreWolf): the subreddit
     * header's "Create Post" button is one (outside #main-content), and at some widths a large
     * "Post to r/…" bar inside #main-content is another. Only the one in the main column is hidden.
     */
    composerBar: 'create-post-entry-point-wrapper',
    /** REScue's own keyboard-selection box (layout/native/selectionView.ts BOX_ID). */
    selectionBoxId: 'rescue-selection',
    /**
     * A subreddit's "Community highlights" (its pinned posts) as cards. VERIFIED LIVE 2026-10-19
     * (r/moderatepolitics, LibreWolf): `community-highlight-carousel` > `shreddit-gallery-carousel`
     * > `li` > `a[href=/r/…/comments/…]` > `community-highlight-card` with light-DOM children
     * `[slot=title]` (the title), `[slot=label]` (avatar + "u/name") and
     * `[slot=upvotes-and-comments]` (two `faceplate-number[number]`: votes, then comments). The
     * label is the author ("u/name") on some subreddits, a flair or a tag ("Megathread") on others
     * (r/GenX, 2026-10-19). Cards carry no posting time.
     */
    highlights: {
      carousel: 'community-highlight-carousel',
      card: 'community-highlight-card',
      title: '[slot="title"]',
      label: '[slot="label"]',
      counts: '[slot="upvotes-and-comments"] faceplate-number',
      countAttr: 'number',
      shownAttr: 'data-rescue-hl',
      /** The card's picture (a preview.redd.it address), when it has one. VERIFIED LIVE (r/GenX). */
      imageAttr: 'src',
      /** A label that is a flair (r/GenX: "Health & Science", with its background colour). */
      flair: '[aria-label^="Flair"]',
    },
    /** The comment's action row wrapper in its grid (hidden while REScue's link row stands in). */
    commentActionBox: 'div:has(> [slot="actionRow"])',
    /** Reddit's own reply box, which appears inside the comment's action row once Reply is pressed. */
    commentComposer: 'comment-composer-host',
    /** The comment thread's header (composer and sort line) and the time Reddit draws in a comment head. */
    commentHeader: 'comment-body-header',
    commentSort: 'comment-body-header shreddit-sort-dropdown',
    headerHost: 'reddit-header-large',
    timeBullet: 'span:has(+ faceplate-tracker > a > faceplate-timeago)',
    timeLink: 'a:has(> faceplate-timeago)',
    timeago: 'faceplate-timeago',
    commentBox: 'details > div.grid',
    commentChildren: '#comment-children',
    commentAvatarBox: 'details > summary > div:has(> [slot="commentAvatar"])',
    headerBar: 'reddit-header-large header',
    /** Elements that declare Reddit's palette variables (so ours must be set on them too). */
    paletteHosts: 'shreddit-app, .grid-container, .sidebar-grid, .stickied',
    feedDivider: 'hr',
    postSlots: {
      title: '[slot="title"]',
      credit: '[slot="credit-bar"]',
      thumbnail: '[slot="thumbnail"]',
      flair: '[slot="post-flair"]',
      textBody: '[slot="text-body"]',
      header: '[slot="ssr-post-content-header"]',
      related: '[slot="related-community-recommendation"]',
    },
    /** Shape A wrappers (children of a feed post, found by what they contain). */
    wrapA: 'div:has([slot="credit-bar"])',
    wrapACredit: 'div:has(> [slot="credit-bar"])',
    wrapAThumb: 'div:has(> [slot="thumbnail"])',
    wrapATitleGroup: 'div:has([slot="title"])',
    wrapATitle: 'div:has(> [slot="title"])',
    wrapAFlair: 'div:has(> [slot="post-flair"])',
    wrapALink: 'div:has(> div > a.post-link)',
    postLink: 'a.post-link',
    /** The credit bar's avatars (community icon on mixed feeds, user icon on subreddit feeds). */
    creditAvatar:
      '[slot="credit-bar"] a[data-testid="subreddit-name"] > div:first-child, [slot="credit-bar"] span.shrink-0:has(> faceplate-hovercard)',
    creditMenuBox: '[slot="credit-bar"] shreddit-async-loader.w-xl',
    thread: {
      back: 'pdp-back-button',
      avatar: '.avatar',
      byline: 'div.flex-col',
    },
    comment: {
      head: 'details > summary',
      headAvatar: 'div:has(> [slot="commentAvatar"])',
      meta: '[slot="commentMeta"]',
      body: '[slot="comment"]',
      grids: 'details > div.grid, #comment-children',
      line: '.ssr-thread-line',
    },
    search: {
      unit: '[data-testid="search-post-unit"], [data-testid="search-post-with-content-preview"]',
      thumb: 'search-telemetry-tracker:last-child',
      title: 'a[data-testid="post-title-text"], a[data-testid="search-post-title-text"]',
      body: '[data-testid="sdui-post-unit"]',
      meta: '.post-credit-row, [data-testid="search-counter-row"]',
      divider: 'hr.list-divider-line',
    },
  },
  /**
   * Reddit's "Suggested communities" blocks (styleTweaks hideSuggestedCommunities). VERIFIED LIVE
   * 2026-10-18 (www., signed in, LibreWolf): `in-feed-community-recommendations` is a light-DOM
   * child of `shreddit-feed` with the heading "Suggested communities" (r/science, between posts).
   * The post slot `related-community-recommendation` is the same kind of block attached to a post;
   * it is a CANDIDATE (seen in the slot list, never rendered in a sample).
   */
  suggestedCommunities:
    'in-feed-community-recommendations, [slot="related-community-recommendation"]',
  /**
   * Promoted posts and ad slots (hidePromoted, research R21). VERIFIED LIVE 2026-10-16 (www.,
   * signed in, both hosts): `shreddit-ad-post` sits in the feed on the home feed, r/popular,
   * r/science and r/pics (4-5 per few screens), and `shreddit-comments-page-ad` sits above a
   * thread's comments. Both are light-DOM elements (credit bar included) and carry `promoted` /
   * `ad-type` attributes and the class `promotedlink`. `shreddit-sidebar-ad` (class `promotedlink`,
   * inside `shreddit-async-loader` in the right sidebar) is present on every page but was empty,
   * `invisible` and 0x0 in every sample: the tag is VERIFIED, a rendered sidebar ad was never seen.
   * The label is a `span.promoted-label` reading "Ad" (not "Promoted") inside the advertiser's
   * /user/ link in the credit bar. The text-pattern fallback for a regular `shreddit-post` carrying
   * that word is a CANDIDATE: no such post was seen live. The word is matched exactly on one leaf
   * element, so a title or a name that merely contains it never matches.
   */
  promoted: {
    post: 'shreddit-ad-post',
    comment: 'shreddit-comments-page-ad',
    sidebar: 'shreddit-sidebar-ad',
    label: {
      scope: '[slot="credit-bar"]',
      /** The label element on a live ad (VERIFIED); used by the live probe, not for hiding. */
      className: '.promoted-label',
      text: /^(?:promoted|sponsored|ad)$/i,
      /** A link around the label (live: the advertiser's /user/ link). A bare word equal to its link's last path segment is a name, not a label. */
      link: 'a[href]',
    },
  },
  /**
   * Build E anchors. VERIFIED LIVE 2026-10-15 (research R20, signed in, www.): the header is light
   * DOM; REScue's header button goes next to `a#create-post` (inside its entry-point wrapper when
   * there is one) in the header's icon strip. A POST author's hover card is a light-DOM
   * `faceplate-hovercard[data-id=user-hover-card]` whose `div[slot=content]` accepts an appended
   * REScue control (its inner card loads into a faceplate-partial on hover). Comment authors have
   * no card. `searchRoots` / `searchTrigger` are CANDIDATES (live: `input[name=q]` has a hidden
   * 0x0 twin, so the visible one is chosen by its box).
   */
  chromeLive: {
    createPost: 'a#create-post',
    createPostWrapper: 'create-post-entry-point-wrapper',
    headerActionItems: 'reddit-header-action-items',
    userHoverCard: 'faceplate-hovercard[data-id="user-hover-card"]',
    hoverCardContent: 'div[slot="content"]',
    searchRoots: 'reddit-search-large, reddit-header-large form[action*="search" i]',
    /**
     * VERIFIED live 2026-10-15 (signed in, www., thread page): the box the user types into is a
     * `<textarea part="control" placeholder="Search">` inside the OPEN shadow root of
     * `faceplate-search-input[name=q]`, itself inside `reddit-search-large`'s open shadow root. The
     * `input[name=q]` twin in the light DOM has a 0x0 box. Read only inside `searchRoots`.
     */
    searchTextarea: 'textarea[placeholder*="search" i]',
    searchTrigger:
      'reddit-search-large button, reddit-search-large [role="button"], ' +
      'reddit-header-large a[href*="/search"], reddit-header-large button[aria-label*="search" i]',
  },

  native: {
    // VERIFIED live 2026-10-15 (signed in, www.) for POSTS: `button[upvote]` / `button[downvote]`
    // directly in shreddit-post's open shadow root, with `aria-pressed="false|true"` and
    // `data-action-bar-action`. COMMENT vote buttons (R20, same day): the same buttons in the
    // comment action row's open shadow root (see commentActions).
    // REScue's own vote arrows (old Reddit look) are never Reddit's buttons: skip any rescue-* button.
    upvote:
      'button[upvote]:not([class*="rescue-"]), button[aria-label*="upvote" i]:not([class*="rescue-"])',
    downvote:
      'button[downvote]:not([class*="rescue-"]), button[aria-label*="downvote" i]:not([class*="rescue-"])',
    voteState: 'aria-pressed',
    reply:
      'button[data-post-click-location="comment-reply"], ' +
      'shreddit-comment-action-row button[aria-label*="reply" i], button[name="reply"]',
    joinButton: 'shreddit-join-button',
    /** A post's own Share button (in its action row's open shadow root, or the light share dropdown on a thread). */
    share:
      'button[part="share-button"], [slot="ssr-share-button"] button, button[aria-label*="share" i]',
    modalScrollLock: 'rpl-scroll-lock',
  },
  composer: {
    host:
      'comment-composer-host, shreddit-composer, ' +
      'shreddit-async-loader[bundlename*="composer" i], faceplate-form[action*="comment" i]',
    editor: 'textarea, [data-lexical-editor], [contenteditable="true"], [contenteditable=""]',
    submit: 'button[type="submit"], [slot="submit-button"], button[slot*="submit" i]',
  },
  ageGate: {
    host: '.configured-xpromo-modal',
    affirm: /\b18\b/i,
    decline: /\bno\b|\bnot\b|\bunder\b|\bback\b|\bleave\b|\bcancel\b/i,
  },
  /** Candidate (FR-008): not yet captured; tests/live/capture.ts sets it. */
  loginWall: {
    overlay: '#desktop-dynamic-upsell-dialog, desktop-dynamic-upsell-modal',
    scrollLockClass: 'rpl-scroll-lock',
  },
  /**
   * Search results (FR-001), VERIFIED LIVE 2026-10-15 (signed in, www. and sh., global search and
   * /r/x/search, identical). A result is NOT a shreddit-post: it is a `search-telemetry-tracker`
   * that carries `view-events="search/view/post"` (nested click trackers carry the same JSON but no
   * view-events). Its computed display is inline but its box is the whole card; there is no
   * <article>. The tracker's `data-faceplate-tracking-context` JSON holds post.id / title / nsfw /
   * spoiler, profile.name (the ONLY place the author appears: no author link is rendered),
   * subreddit.name and action_info.position. The title link is a full-card overlay (`absolute
   * inset-0`); the credit row is position:relative and later in the DOM, so nodes placed inside it
   * paint above the overlay and stay clickable. Votes and comment counts are the first and second
   * `faceplate-number[number]` of the counter row. There is no upvote ratio and no vote buttons.
   * Infinite scroll appends more results of the same shape.
   */
  search: {
    post: 'search-telemetry-tracker[view-events="search/view/post"]',
    contextAttr: 'data-faceplate-tracking-context',
    titleLink: 'a[data-testid="post-title"]',
    titleText: 'a[data-testid="post-title-text"]',
    creditRow: '.post-credit-row',
    time: 'faceplate-timeago',
    counterRow: '[data-testid="search-counter-row"]',
    number: 'faceplate-number',
    numberAttr: 'number',
  },
  /**
   * CANDIDATE (US8 searchHelper): query-string parameters of Reddit's search page, from memory and
   * not yet captured. `restrict` = 1 limits a search to the subreddit named in the path.
   */
  searchParams: { query: 'q', sort: 'sort', time: 't', restrict: 'restrict_sr' },
  searchPathEnd: /\/search\/?$/,

  /**
   * Same-origin, read-only JSON endpoints (constitution Principle V, research R20 item 4). Only
   * GET, only with the reader's own session, only when the feature that needs one is used. All
   * five were observed live while signed in on 2026-10-15. `{id}` in `comments` is a post id
   * without its `t3_` prefix. oauth.reddit.com is blocked and /api/v1/me/* returns 403: never use.
   */
  json: {
    mine: '/subreddits/mine.json',
    info: '/api/info.json',
    comments: '/comments/{id}.json',
    me: '/api/me.json',
    blocked: '/prefs/blocked.json',
  },

  hover: {
    userEndpoint: '/svc/shreddit/user-hover-card/',
    communityEndpoint: '/svc/shreddit/community-hover-card/',
    accept: 'text/vnd.reddit.partial+html, text/html;q=0.9',
    userCard: '[data-testid="user-hover-card"]',
    cakeDay: 'time[data-testid="cake-day"]',
    karma: '[data-testid="karma-number"]',
    nameplate: '[data-testid="nameplate"]',
    verified: '[data-testid="verification-icon"]',
    postKarmaLabel: /post karma/i,
    commentKarmaLabel: /comment karma/i,
    communityActive: '[data-testid="community-hover-card:active-count"]',
    communityNumber: 'faceplate-number',
    communityNumberAttr: 'number',
    weeklyVisitorsLabel: /weekly visitors/i,
    weeklyContributionsLabel: /weekly contributions/i,
  },
} as const;

/** Registry metadata: status, requirement and consumers for every contract (page-contracts.md). */
export const CONTRACTS: PageContract[] = [
  {
    key: 'app',
    kind: 'selector',
    value: C.app,
    required: true,
    status: 'inherited',
    usedBy: 'core',
  },
  // Theme class on <html>, verified live 2026-10-15 (src/core/theme.ts).
  {
    key: 'theme.darkClass',
    kind: 'attribute',
    value: C.themeDarkClass,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: 'core',
  },
  {
    key: 'feed',
    kind: 'selector',
    value: C.feed,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'post',
    kind: 'selector',
    value: C.post,
    required: true,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'post.attrs',
    kind: 'attribute',
    value: Object.values(C.postAttr).join(','),
    required: true,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'post.body',
    kind: 'selector',
    value: C.postBody,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'post.mediaContainer',
    kind: 'selector',
    value: `${C.post} > ${C.mediaContainer}`,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['inlineMedia'],
  },
  {
    key: 'comment.mediaFigure',
    kind: 'selector',
    value: `${C.commentBody} ${C.commentMedia.figure}`,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-16',
    usedBy: ['inlineMedia'],
  },
  {
    key: 'feed.partial',
    kind: 'selector',
    value: C.feedPartial,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-16',
    usedBy: ['neverEndingReddit'],
  },
  {
    key: 'feed.empty',
    kind: 'selector',
    value: C.feedEmpty,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'commentTree',
    kind: 'selector',
    value: C.commentTree,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'comment',
    kind: 'selector',
    value: C.comment,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'comment.attrs',
    kind: 'attribute',
    value: Object.values(C.commentAttr).join(','),
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'comment.body',
    kind: 'selector',
    value: C.commentBody,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'comment.partial',
    kind: 'selector',
    value: C.commentPartial,
    required: false,
    status: 'inherited',
    usedBy: ['neverEndingComments'],
  },
  {
    key: 'comment.scoreHidden',
    kind: 'attribute',
    value: C.commentScoreHidden,
    required: false,
    status: 'candidate',
    usedBy: 'core',
  },
  {
    key: 'comment.details',
    kind: 'selector',
    value: `${C.commentDetails} > ${C.commentSummary}`,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['commentHidePersistor'],
  },
  {
    key: 'comment.threadline',
    kind: 'selector',
    value: C.commentThreadline,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-16',
    usedBy: ['commentQuickCollapse'],
  },
  {
    key: 'comment.collapsed',
    kind: 'attribute',
    value: C.commentCollapsedAttr,
    required: false,
    status: 'candidate',
    usedBy: ['commentQuickCollapse'],
  },
  {
    key: 'comment.moreReplies',
    kind: 'selector',
    value: C.moreRepliesControl,
    required: false,
    status: 'candidate',
    usedBy: ['keyboardNavExtras'],
  },
  {
    // TEXT-PATTERN contract: the "N more replies" control has no stable attribute, so its words
    // are the anchor. Fails safe: no match means the key is left to Reddit.
    key: 'comment.moreReplies.text',
    kind: 'text-pattern',
    value: C.moreRepliesLabel,
    required: false,
    status: 'candidate',
    usedBy: ['keyboardNavExtras'],
  },
  {
    // Re-applying a remembered collapse (details.open = false, else a click on Reddit's summary).
    key: 'comment.collapseApply',
    kind: 'selector',
    value: C.commentDetails,
    required: false,
    status: 'candidate',
    usedBy: ['commentHidePersistor'],
  },
  {
    key: 'post.threadLink',
    kind: 'selector',
    value: C.threadLink,
    required: false,
    status: 'candidate',
    usedBy: ['commentSortBy'],
  },
  {
    key: 'comment.distinguished',
    kind: 'attribute',
    value: C.commentDistinguished.moderator,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userHighlight', 'commentNavigator'],
  },
  // --- comment actions and post flags (R20, verified live 2026-10-15, signed in) -----------------
  {
    key: 'comment.actionRow',
    kind: 'selector',
    value: C.commentActions.row,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['keyboardActions', 'userTagger', 'filteReddit', 'voteEnhancements'],
  },
  {
    key: 'comment.voteButtons',
    kind: 'selector',
    value: 'button[upvote], button[downvote]',
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['keyboardActions', 'userTagger'],
  },
  {
    // UP and DOWN values not yet observed live (NONE was); read loosely and only as confirmation.
    key: 'comment.voteState',
    kind: 'attribute',
    value: C.commentActions.voteStateAttr,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['keyboardActions'],
  },
  {
    key: 'comment.scoreHidden.row',
    kind: 'attribute',
    value: C.commentActions.scoreHiddenAttr,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['filteReddit', 'voteEnhancements'],
  },
  {
    key: 'comment.reply',
    kind: 'selector',
    value: C.commentActions.replyButton,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['keyboardActions'],
  },
  {
    key: 'comment.overflowMenu',
    kind: 'selector',
    value: `${C.commentActions.overflowMenu} ${C.commentActions.overflowTrigger}`,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['keyboardActions'],
  },
  {
    // TEXT-PATTERN contract: the Edit item has no stable attribute, so it is found by its words.
    // Fails safe: when no item matches, nothing is clicked and the user is told.
    key: 'comment.editItem',
    kind: 'text-pattern',
    value: C.commentActions.editItemText,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['keyboardActions'],
  },
  // --- save / hide menu rows (this lane, recorded live read-only 2026-10-16; CANDIDATE) ---------
  {
    key: 'post.saveHideMenu',
    kind: 'selector',
    value: C.saveHide.postMenu,
    required: false,
    status: 'candidate',
    usedBy: ['keyboardActions', 'autoHide', 'hideLinks'],
  },
  {
    key: 'saveHide.item',
    kind: 'selector',
    value: C.saveHide.item,
    required: false,
    status: 'candidate',
    usedBy: ['keyboardActions', 'autoHide', 'hideLinks'],
  },
  {
    // TEXT-PATTERN contract: the Save row has no stable attribute, so it is found by its words.
    // Fails safe: when no row matches, nothing is clicked and the user is told.
    key: 'saveHide.saveItem',
    kind: 'text-pattern',
    value: C.saveHide.saveText,
    required: false,
    status: 'candidate',
    usedBy: ['keyboardActions'],
  },
  {
    key: 'saveHide.hideItem',
    kind: 'text-pattern',
    value: C.saveHide.hideText,
    required: false,
    status: 'candidate',
    usedBy: ['keyboardActions', 'autoHide', 'hideLinks'],
  },
  {
    key: 'post.locked',
    kind: 'attribute',
    value: C.postFlagAttrs.locked,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['filteReddit'],
  },
  {
    key: 'post.stickied',
    kind: 'attribute',
    value: C.postFlagAttrs.stickied,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['filteReddit'],
  },
  {
    key: 'post.authorLink',
    kind: 'selector',
    value: C.postAuthorLink,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userTagger', 'userHighlight'],
  },
  {
    key: 'post.slots',
    kind: 'attribute',
    value: Object.values(C.slots).slice(0, 2).join(','),
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: 'core',
  },
  {
    key: 'comment.authorLink',
    kind: 'selector',
    value: `[slot="${C.slots.commentMeta}"] ${C.commentAuthorLink}`,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userTagger', 'userHighlight'],
  },
  {
    key: 'comment.slots',
    kind: 'attribute',
    value: C.slots.commentMeta,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: 'core',
  },
  {
    key: 'session.username',
    kind: 'selector',
    value: C.session.usernameAttrSel,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'session.signedIn',
    kind: 'selector',
    value: C.session.loggedIn,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'partial.loadMethod',
    kind: 'attribute',
    value: C.partialLoadMethod,
    required: false,
    status: 'inherited',
    usedBy: 'core',
  },
  {
    key: 'hover.user.endpoint',
    kind: 'endpoint',
    value: C.hover.userEndpoint,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userInfo', 'showKarma'],
  },
  {
    key: 'hover.community.endpoint',
    kind: 'endpoint',
    value: C.hover.communityEndpoint,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['subredditInfo'],
  },
  {
    key: 'hover.accept',
    kind: 'header',
    value: C.hover.accept,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userInfo', 'subredditInfo'],
  },
  {
    key: 'hover.user.card',
    kind: 'selector',
    value: C.hover.userCard,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userInfo'],
  },
  {
    key: 'hover.user.cakeDay',
    kind: 'selector',
    value: C.hover.cakeDay,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userInfo'],
  },
  {
    key: 'hover.user.karma',
    kind: 'selector',
    value: C.hover.karma,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userInfo', 'showKarma'],
  },
  {
    key: 'hover.community.activeCount',
    kind: 'selector',
    value: C.hover.communityActive,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['subredditInfo'],
  },
  // --- same-origin JSON reads (research R20 item 4; src/core/redditJson.ts) -------------------
  {
    key: 'json.mine',
    kind: 'endpoint',
    value: C.json.mine,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['subredditManager'],
  },
  {
    key: 'json.info',
    kind: 'endpoint',
    value: C.json.info,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['threadSubscriptions'],
  },
  {
    key: 'json.comments',
    kind: 'endpoint',
    value: C.json.comments,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: [],
  },
  {
    key: 'json.me',
    kind: 'endpoint',
    value: C.json.me,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: [],
  },
  {
    key: 'json.blocked',
    kind: 'endpoint',
    value: C.json.blocked,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['userTagger'],
  },
  {
    key: 'ageGate.confirm',
    kind: 'selector',
    value: C.ageGate.host,
    required: false,
    status: 'inherited',
    usedBy: ['interstitials'],
  },
  {
    key: 'loginWall.overlay',
    kind: 'selector',
    value: C.loginWall.overlay,
    required: false,
    status: 'inherited',
    usedBy: ['interstitials'],
  },
  {
    key: 'search.post',
    kind: 'selector',
    value: C.search.post,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: 'core',
  },
  {
    key: 'search.context',
    kind: 'attribute',
    value: C.search.contextAttr,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: 'core',
  },
  {
    key: 'search.titleLink',
    kind: 'selector',
    value: C.search.titleLink,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: 'core',
  },
  {
    key: 'search.titleText',
    kind: 'selector',
    value: C.search.titleText,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: 'core',
  },
  {
    key: 'search.creditRow',
    kind: 'selector',
    value: C.search.creditRow,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: ['userTagger', 'localDate'],
  },
  {
    key: 'search.time',
    kind: 'selector',
    value: C.search.time,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: ['userTagger', 'localDate'],
  },
  {
    key: 'search.counterRow',
    kind: 'selector',
    value: C.search.counterRow,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: 'core',
  },
  {
    key: 'search.number',
    kind: 'attribute',
    value: C.search.numberAttr,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    hosts: ['www', 'sh'],
    usedBy: 'core',
  },
  {
    key: 'customFeed.feed',
    kind: 'selector',
    value: C.feed,
    required: false,
    status: 'candidate',
    usedBy: 'core',
  },
  {
    key: 'post.time',
    kind: 'selector',
    value: C.postTime,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['localDate'],
  },
  {
    key: 'time.ts',
    kind: 'attribute',
    value: C.time.tsAttr,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['localDate'],
  },
  {
    key: 'comment.time',
    kind: 'selector',
    value: C.time.commentTime,
    required: false,
    status: 'candidate',
    usedBy: ['localDate'],
  },
  {
    key: 'search.params',
    kind: 'attribute',
    value: Object.values(C.searchParams).join(','),
    required: false,
    status: 'candidate',
    usedBy: ['searchHelper'],
  },
  {
    key: 'chrome.logoLink',
    kind: 'selector',
    value: C.chrome.logoLink,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['logoLink'],
  },
  {
    key: 'chrome.searchForm',
    kind: 'selector',
    value: C.chrome.searchForm,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['searchHelper'],
  },
  {
    key: 'chrome.chatEntry',
    kind: 'selector',
    value: C.chrome.chatEntry,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-15',
    usedBy: ['disableChat'],
  },
  {
    key: 'chrome.userMenu',
    kind: 'selector',
    value: C.chrome.userMenu,
    required: false,
    status: 'candidate',
    usedBy: ['usernameHider'],
  },
  {
    key: 'chrome.visitedLinks',
    kind: 'selector',
    value: C.chrome.visitedLinks,
    required: false,
    status: 'candidate',
    usedBy: ['styleTweaks'],
  },
  {
    key: 'chrome.topLevelComment',
    kind: 'selector',
    value: C.chrome.topLevelComment,
    required: false,
    status: 'candidate',
    usedBy: ['styleTweaks'],
  },
  {
    key: 'chrome.postTitle',
    kind: 'selector',
    value: C.chrome.postTitle,
    required: false,
    status: 'candidate',
    usedBy: ['styleTweaks'],
  },
  {
    key: 'suggestedCommunities',
    kind: 'selector',
    value: C.suggestedCommunities,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-18',
    usedBy: ['styleTweaks'],
  },
  {
    key: 'promoted.post',
    kind: 'selector',
    value: C.promoted.post,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-16',
    usedBy: ['hidePromoted'],
  },
  {
    key: 'promoted.comment',
    kind: 'selector',
    value: C.promoted.comment,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-16',
    usedBy: ['hidePromoted'],
  },
  {
    key: 'promoted.sidebar',
    kind: 'selector',
    value: C.promoted.sidebar,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-16',
    usedBy: ['hidePromoted'],
  },
  {
    key: 'promoted.label',
    kind: 'text-pattern',
    value: C.promoted.label.text,
    required: false,
    status: 'candidate',
    usedBy: ['hidePromoted'],
  },
  // Old Reddit look (R23), all VERIFIED LIVE 2026-10-18; a stylesheet that matches nothing is inert.
  {
    key: 'skin.pageGrid',
    kind: 'selector',
    value: C.skin.pageGrid,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-18',
    usedBy: ['oldRedditSkin'],
  },
  {
    key: 'skin.mainGrid',
    kind: 'selector',
    value: C.skin.mainGrid,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-18',
    usedBy: ['oldRedditSkin'],
  },
  {
    key: 'skin.postWrapper',
    kind: 'selector',
    value: C.skin.wrapA,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-18',
    usedBy: ['oldRedditSkin'],
  },
  {
    key: 'skin.postThumbnail',
    kind: 'selector',
    value: C.skin.postSlots.thumbnail,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-18',
    usedBy: ['oldRedditSkin'],
  },
  {
    key: 'skin.commentHead',
    kind: 'selector',
    value: C.skin.comment.head,
    required: false,
    status: 'verified',
    verifiedAt: '2026-10-18',
    usedBy: ['oldRedditSkin'],
  },
  {
    key: 'inbox.badge',
    kind: 'selector',
    value: '',
    required: false,
    status: 'candidate',
    usedBy: ['orangered'],
  },
];

export function contractStatus(key: string): ContractStatus | undefined {
  return CONTRACTS.find((c) => c.key === key)?.status;
}

/** A candidate with no captured value is unusable; callers treat it as absent. */
export function contractUsable(key: string): boolean {
  const c = CONTRACTS.find((x) => x.key === key);
  return !!c && c.status !== 'candidate' && c.value !== '';
}
