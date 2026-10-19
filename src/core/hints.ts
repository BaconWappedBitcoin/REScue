/**
 * Hover text (native `title` tooltips) for every control REScue adds to Reddit's pages. All the
 * wording lives here so it stays consistent and reviewable. Each text starts with "REScue: " so a
 * reader can tell REScue's controls from Reddit's own. Toggles are functions of their current
 * state: the text says what a click will do NOW, and the module calls it again when the state
 * changes. Icon-only controls also take `plain(text)` as their aria-label (the same words without
 * the prefix). Keep each text under about 120 characters.
 */

/** The hide reason the user tagger gives items by an ignored user. */
export const IGNORED_USER = 'ignored user';

const PREFIX = 'REScue: ';
const r = (s: string): string => PREFIX + s;
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** The text without the "REScue: " prefix, for aria-label. */
export const plain = (text: string): string =>
  text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text;

/**
 * Visible words for REScue's small controls (instead of icons, as RES does). Keep them short and
 * lowercase so the credit bar stays on one line; the hover text below says what each one does.
 */
export const label = {
  filter: 'filter…',
  tag: 'tag user',
  navPrev: 'prev',
  navNext: 'next',
  close: 'close',
  add: 'add',
  edit: 'edit',
  sort: 'sort',
  scrollBack: 'back',
  scrollMore: 'more',
  subscribe: 'subscribe',
  unsubscribe: 'unsubscribe',
  mySubs: 'my subreddits',
  importSubs: 'import',
  importBlocked: 'import blocked',
  clear: 'clear',
  selectAll: 'all',
  refresh: 'refresh',
  gear: 'REScue',
  search: 'search',
  top: 'top',
  settings: 'settings',
  drag: 'drag',
  up: 'up',
  down: 'down',
  remove: 'remove',
  wheel: 'wheel',
  noColor: 'none',
  ignore: 'ignore',
  unignore: 'unignore',
  highlight: 'highlight',
  loadMore: 'load more',
  loading: 'loading…',
  pause: 'pause',
  resume: 'resume',
  pausedState: 'paused',
  autoLoadingState: 'auto-loading',
  dashboard: 'dashboard',
} as const;

/**
 * The word on a post's media control: "show image", "hide video", "show gallery (5)". `count` is
 * the number of pictures when known (a gallery of two or more).
 */
export const mediaLabel = (collapsed: boolean, kind: string, count = 0): string =>
  `${collapsed ? 'show' : 'hide'} ${kind}${count >= 2 ? ` (${count})` : ''}`;

/** The word on a comment's media control: "show image", "hide GIF", "show video". */
export const commentMediaLabel = (hidden: boolean, kind: string): string =>
  `${hidden ? 'show' : 'hide'} ${kind}`;

/**
 * The line between two comments in the show-parent popup. The popup lists a chain either nearest
 * parent first (it opened below the control) or topmost first (it opened above), so the words and
 * the arrow say which neighbour replies to which in both orders.
 */
export const parentArrowText = (direction: 'up' | 'down'): string =>
  direction === 'up'
    ? '↑ the comment below replies to the one above'
    : 'the comment above replies to the one below ↓';

export const hint = {
  // --- the corner tool strip, the gear and its menu ------------------------------------------
  gear: (action: 'menu' | 'settings' | 'commandLine' = 'menu'): string =>
    action === 'settings'
      ? r('open the REScue settings console')
      : action === 'commandLine'
        ? r('open the REScue command line (also the . key)')
        : r('open the REScue menu: settings, command line and quick switches'),
  menuSettings: r('open the settings console, where every REScue feature is switched on or off'),
  menuSettingsSearch: r('open the settings console and search for a setting'),
  menuCommandLine: r(
    'open the command line: go to r/sub or u/name, search, change settings (. key)',
  ),
  menuAbout: r('show the REScue version, source code and privacy information'),
  menuHideNsfw: (on: boolean): string =>
    on
      ? r('NSFW posts are hidden everywhere. Click to show them again')
      : r('NSFW posts are shown. Click to hide them everywhere'),
  menuCustomToggle: (name: string, on: boolean): string =>
    on
      ? r(`“${name}” is on. Click to turn off the filter rules tied to it`)
      : r(`“${name}” is off. Click to turn on the filter rules tied to it`),
  menuOldLook: (on: boolean): string =>
    on
      ? r('feeds and threads look like old Reddit. Click to go back to Reddit’s own look (live, no reload)')
      : r('restyle feeds, search results and threads to look like old Reddit (Reddit’s own page, restyled)'),
  menuItem: (label: string): string => r(label),
  backToTop: r('scroll back to the top of the page'),
  showKarma: r('your post karma, then your comment karma, as Reddit’s own user card reports them'),
  jumpToCommentBox: r('scroll to the box for writing a comment (or to the first comment)'),
  menuCommentNavigator: (open: boolean): string =>
    open
      ? r('hide the comment navigator (Shift+N)')
      : r(
          'show the comment navigator: step through OP, mod, new or other matching comments (Shift+N)',
        ),
  hideAllReplies: (allHidden: boolean): string =>
    allHidden
      ? r('show the replies under every comment again (Shift+C)')
      : r('hide the replies under every top-level comment, keeping the comments (Shift+C)'),
  savedOpener: (count: number): string =>
    count
      ? r(
          `open the ${count} ${plural(count, 'comment', 'comments')} you kept with save-RES on this device`,
        )
      : r('open your list of saved comments (empty: use “save-RES” on a comment)'),
  filterSubToggle: (sub: string, filtered: boolean): string =>
    filtered
      ? r(`stop hiding r/${sub} in your other feeds`)
      : r(`hide posts from r/${sub} in every feed except r/${sub} itself`),

  // --- the comment navigator -----------------------------------------------------------------
  navRoot: r('comment navigator: step through the comments that match a category'),
  navCategory: r('choose which comments the prev and next buttons step through (OP, mods, new, …)'),
  navSkipRead: r('leave out comments that were already there at your last visit'),
  navPrev: r('go to the previous matching comment (Shift+↑)'),
  navNext: r('go to the next matching comment (Shift+↓)'),
  navClose: r('hide the comment navigator (Shift+N brings it back)'),
  /** `label` is what the button shows: "3/12", "~3/12" (you moved away from it), "0/12", "none". */
  navPosition: (label: string): string => {
    const m = /^(~?)(\d+)\/(\d+)$/.exec(label);
    const back = 'click to return to the last one you reached';
    if (!m) return r('no comment matches this category');
    const [, away, at, total] = m;
    if (at === '0')
      return r(
        `${total} matching ${plural(Number(total), 'comment', 'comments')}, none reached yet: use next`,
      );
    return r(`match ${at} of ${total}${away ? ' (you have moved off it)' : ''}: ${back}`);
  },

  // --- filteReddit ---------------------------------------------------------------------------
  filterButton: r('filter this post: hide posts from its subreddit, user or domain'),
  filterMenuItem: (kind: 'subreddit' | 'user' | 'domain', name: string): string =>
    kind === 'subreddit'
      ? r(`hide posts from r/${name} everywhere except on r/${name} itself`)
      : kind === 'user'
        ? r(`hide every post by u/${name}`)
        : r(`hide every link post to ${name}`),
  filterCount: r('how many posts and comments your filters are hiding on this page'),
  filterReveal: (revealing: boolean): string =>
    revealing
      ? r('hide the filtered items again')
      : r('show the filtered items, each marked with the rule that matched'),
  filterPower: (on: boolean): string =>
    on
      ? r('filters are on. Click to pause them on this page only (not saved)')
      : r('filters are paused on this page. Click to turn them back on'),
  filterRules: r('open the filter rules in the settings console'),
  filterDetail: (verb: string, detail: string): string => r(`${verb.toLowerCase()}: ${detail}`),
  filterReason: (verb: string, reason: string): string =>
    reason === IGNORED_USER
      ? r('you ignore this user (tag editor), so their posts and comments are hidden')
      : r(`${verb.toLowerCase()} by your filter rule (${reason})`),
  filterPlaceholder: r('a post your filters removed from this feed'),
  filterPlaceholderButton: (peeking: boolean): string =>
    peeking ? r('hide this filtered post again') : r('show this filtered post'),
  autoHideCount: r('how many posts you have already opened are hidden from this feed'),
  autoHideToggle: (revealing: boolean): string =>
    revealing
      ? r('hide the opened posts again')
      : r('show the posts hidden because you opened them'),

  // --- inline media (inlineMedia) --------------------------------------------------------------
  mediaToggle: (collapsed: boolean, kind: string): string =>
    collapsed
      ? r(`show this post's ${kind} (X shows or hides the selected post's media)`)
      : r(`hide this post's ${kind} (X hides or shows the selected post's media)`),
  menuHideMedia: (on: boolean): string =>
    on
      ? r('media in comments is hidden. Click to show it again (Shift+X toggles every post and comment)')
      : r('media in comments is shown. Click to hide it, with a word in its place to bring it back'),
  mediaAllowTab: r('let this tab download media even though blocking is on, until you close it'),
  mediaTurnOffBlocking: r('stop blocking media downloads in every tab (you can turn it on again)'),
  mediaReload: r('reload this page so the media that was blocked can load'),
  mediaAskPermission: r('open the window that asks the browser for permission to block media'),
  mediaPermAllow: r('ask the browser for permission to block downloads from Reddit media servers'),
  mediaPermCancel: r('close this window without giving permission'),

  // --- marks beside a post or comment ----------------------------------------------------------
  singleClick: (both: boolean): string =>
    both
      ? r('open the link and its comments in new tabs (Ctrl or middle click: background tabs)')
      : r('open the comments in a new tab'),
  upvoteRatio: (label: string): string =>
    r(`${label.replace(/ upvoted$/, '')} of this post’s votes are upvotes, as Reddit reports it`),
  scoreChip: (what: 'post' | 'comment', score: number): string =>
    r(
      `this ${what} has ${score} ${plural(score, 'point', 'points')}, as Reddit reports it; the colour is your own setting`,
    ),
  subredditTag: (sub: string): string => r(`your own tag for r/${sub} (Subreddit tagger settings)`),
  newCount: (n: number): string =>
    r(`${n} ${plural(n, 'comment', 'comments')} posted since you last opened this thread`),
  newMarker: (visit: string): string => r(`posted after your last visit (${visit})`),
  newBanner: r('comments in this thread posted since your last visit'),
  localDate: (label: string): string => r(`posted ${label}, in your local time`),
  hideChildren: (hidden: boolean, total: number): string =>
    hidden
      ? r(`show the ${total} hidden ${plural(total, 'reply', 'replies')} to this comment (C)`)
      : r('hide the replies to this comment, keeping the comment itself (C)'),
  showParent: r('jump to the comment this replies to. Hover to read the whole chain (Shift+P)'),
  gotoParent: r('scroll to this parent comment and select it'),
  parentPreview: r('a parent comment, copied here so you can read it'),
  parentArrow: (direction: 'up' | 'down'): string =>
    direction === 'up'
      ? r('the comment below is a reply to the comment above')
      : r('the comment above is a reply to the comment below'),
  saveComment: (saved: boolean): string =>
    saved
      ? r('saved on this device. Click to remove your copy (unsave-RES)')
      : r('keep a copy of this comment’s text on this device only (not Reddit’s save)'),
  hidePost: r('hide this post on Reddit through Reddit’s own Hide, so it stays gone on every device'),
  hidePostFading: (seconds: string): string =>
    r(`hide this post on Reddit in ${seconds} seconds`),
  savedPanel: r('comments you kept with save-RES, stored on this device'),
  savedClose: r('close the saved comments list'),
  savedOpen: r('open the saved comment on Reddit in a new tab'),
  savedRemove: (author: string): string => r(`delete your saved copy of u/${author}’s comment`),
  tableHeader: r('click to sort this table by this column, click again to reverse'),
  authorMark: (cls: string): string | undefined =>
    ({
      'rescue-mod-author': r('highlighted: moderator'),
      'rescue-admin-author': r('highlighted: Reddit admin'),
      'rescue-friend-author': r('highlighted: one of your friends (User highlighting)'),
      'rescue-tagged-author': r('highlighted: a user you tagged'),
      'rescue-self-author': r('highlighted: you'),
    })[cls],

  // --- users: tags, vote counts, ignoring ---------------------------------------------------------
  tagButton: (user: string): string =>
    r(`tag u/${user}: add a note, colour or link to this user, or ignore them`),
  ignoreUser: (user: string, ignored: boolean): string =>
    ignored
      ? r(`unignore u/${user} — show their comments and posts again`)
      : r(`ignore u/${user} — their comments collapse everywhere (undo from here or the tag editor)`),
  tagChip: (text: string, user?: string): string =>
    user ? r(`your tag for u/${user}: ${text}`) : r(`tag: ${text}`),
  tagLink: r('open the link saved with this tag'),
  votePill: (user: string, tally: string): string =>
    r(`your votes on u/${user} so far: ${tally} (up, down). Click to edit`),
  ignoreToggle: (open: boolean): string =>
    open
      ? r('collapse this comment from an ignored user again')
      : r('show this comment from a user you ignore'),

  // --- the tag editor and manager --------------------------------------------------------------
  tagText: r('the short note shown beside this user’s name'),
  tagColor: r('tag colour as #rrggbb, or blank for none'),
  tagPicker: r('pick the tag colour'),
  tagSwatch: (name: string): string => r(`use the colour ${name}`),
  tagSwatchNone: r('no colour: the tag uses the default look'),
  tagSwatches: r('colour presets: click one to use it'),
  tagLinkField: r('a web address to keep with the tag, such as the post where you noticed them'),
  tagOpen: r('open the saved link in a new tab'),
  tagIgnore: r('hide this user’s posts and collapse their comments'),
  tagVotesUp: r('how many times you have upvoted this user'),
  tagVotesDown: r('how many times you have downvoted this user'),
  tagPreview: r('how the tag will look beside the name'),
  tagSave: r('save this tag'),
  tagDelete: r('remove this tag'),
  tagCancel: r('close without saving'),
  tagAddPreset: r('keep this tag as a one-click preset'),
  tagManage: r('list every user you have tagged'),
  tagPresets: r('your preset tags'),
  tagPreset: (text: string, color?: string): string =>
    r(`use the preset tag “${text}”${color ? ` (${color})` : ''}`),
  tagTitle: r('the user this tag is for'),
  tagError: r('why the tag could not be saved'),
  managerSearch: r('filter the list by user name, tag text or link'),
  managerSort: r('choose how the tagged users are ordered'),
  managerClose: r('close the tagged users list'),
  managerEdit: (user: string): string => r(`edit the tag for u/${user}`),
  managerDelete: (user: string, armed: boolean): string =>
    armed ? r(`click again to delete the tag for u/${user}`) : r(`delete the tag for u/${user}`),
  managerUser: (user: string): string => r(`open u/${user}’s profile in a new tab`),
  managerIgnored: r('you ignore this user'),
  managerCount: r('how many users you have tagged'),
  managerTable: r('your tagged users'),

  // --- the shortcut bar --------------------------------------------------------------------------
  shortcutStatic: (text: string): string => r(`go to ${text}`),
  shortcutLink: (text: string): string =>
    r(`your shortcut: go to ${text} (right-click to edit, drag to reorder)`),
  shortcutGroupLink: (sub: string): string => r(`go to r/${sub}, part of this shortcut group`),
  shortcutEdit: r('edit or delete this shortcut'),
  shortcutAdd: r('add a subreddit or page to this bar'),
  shortcutSort: r('sort the shortcuts by name or by date added'),
  shortcutSortMode: (label: string): string => r(`sort the shortcuts: ${label}`),
  shortcutArrow: (dir: 'left' | 'right'): string => r(`scroll the shortcuts ${dir}`),
  shortcutTrash: r('drop a dragged shortcut here to delete it'),
  shortcutSeparator: r('separates the standard links from your own shortcuts'),
  shortcutToggle: (sub: string, present: boolean): string =>
    present ? r(`remove r/${sub} from your shortcut bar`) : r(`add r/${sub} to your shortcut bar`),
  shortcutTarget: r('the subreddit (r/name) or Reddit path this shortcut opens'),
  shortcutLabel: r('optional text to show on the bar instead of the name'),
  shortcutSave: r('save this shortcut'),
  shortcutDelete: r('remove this shortcut from the bar'),
  shortcutCancel: r('close without saving'),
  shortcutError: r('why the shortcut could not be saved'),

  // --- features that read your own Reddit account (same-origin, read-only JSON) -------------------
  signIn: r('sign in to Reddit to use this; it reads your own account'),
  threadSubscribe: (on: boolean, days: number): string =>
    on
      ? r('stop watching this thread for new comments')
      : r(`watch this thread for new comments for ${days} ${plural(days, 'day', 'days')}`),
  threadSubscribeSignedOut: r('sign in to Reddit to watch threads for new comments'),
  subsMenu: (fresh: number): string =>
    fresh
      ? r(
          `${fresh} new ${plural(fresh, 'comment', 'comments')} in threads you watch: open the list`,
        )
      : r('list the threads you watch for new comments'),
  subsPanel: r('the threads you watch for new comments'),
  subsRow: (title: string): string => r(`open “${title.slice(0, 60)}”`),
  subsBadge: (n: number): string =>
    r(`${n} new ${plural(n, 'comment', 'comments')} since you last opened this thread`),
  subsExpires: (when: string): string => r(`REScue stops watching this thread on ${when}`),
  subsUnsubscribe: r('stop watching this thread'),
  subsClear: r('mark every watched thread as seen'),
  subsClose: r('close the list of watched threads'),
  subsEmpty: r('open a thread and press “subscribe” to watch it'),
  subsOpen: r('open the thread that has new comments'),
  mineButton: r('list the subreddits you subscribe to, to open them or add them to this bar'),
  mineSignedOut: r('sign in to Reddit to list the subreddits you subscribe to'),
  mineSearch: r('filter your subscribed subreddits by name'),
  mineList: r('your subscribed subreddits'),
  mineGo: (name: string): string => r(`go to ${name}`),
  minePick: (name: string, on: boolean): string =>
    r(`${on ? 'leave out' : 'select'} ${name} when adding to the bar`),
  mineImport: (n: number): string =>
    n
      ? r(`add the ${n} selected ${plural(n, 'subreddit', 'subreddits')} to this bar`)
      : r('tick subreddits first, then add them to this bar'),
  mineAll: r('select every subreddit listed here'),
  mineNone: r('clear the selection'),
  mineRefresh: r('read your subscriptions from Reddit again'),
  mineClose: r('close the list of your subreddits'),
  blockedAction: r(
    'read the users you blocked on Reddit and ignore them in REScue, after you confirm',
  ),
  blockedPreview: r('the users that would be ignored'),
  blockedConfirm: (n: number): string =>
    r(`ignore ${n} ${plural(n, 'user', 'users')} in REScue (Reddit itself is not changed)`),
  blockedCancel: r('close without changing anything'),

  // --- overlays: link numbers, wheel pad, popups, help, command line -------------------------------
  linkNumber: (digit: string, keys: 'digit' | 'alt' = 'digit'): string =>
    r(`press ${keys === 'alt' ? 'Alt+' : ''}${digit} to open this link`),
  wheelPad: r('scroll the mouse wheel over this to move the selection through the page'),
  hoverClose: r('close this popup'),
  helpClose: r('close the shortcut list (Esc)'),
  helpRow: (keys: string, title: string): string => r(`press ${keys} to: ${title}`),
  cmdInput: r('command line: type a command, Enter runs it (Shift+Enter: new tab, Esc: close)'),
  cmdTip: r('example commands, or what the command you are typing will do'),
  cmdList: r('the commands that match what you typed'),

  // --- header button, hover-card actions, feed pause, x-post links ---------------------------------
  headerButton: r('open the REScue menu: settings, command line and quick switches'),
  hoverTag: (user: string): string =>
    r(`tag u/${user}: add a note, colour or link, or ignore them`),
  hoverIgnore: (user: string, on: boolean): string =>
    on
      ? r(`u/${user} is ignored. Click to stop ignoring them`)
      : r(`ignore u/${user}: hide their posts and collapse their comments`),
  hoverHighlight: (user: string, on: boolean): string =>
    on
      ? r(`u/${user} is highlighted. Click to remove the highlight`)
      : r(`highlight u/${user} in your highlight colour wherever their name shows`),
  feedLoadMore: (busy: boolean): string =>
    busy
      ? r('loading the next page of posts from Reddit')
      : r('load the next page of posts (automatic loading is paused)'),
  feedPause: (paused: boolean): string =>
    paused
      ? r('automatic loading of more posts is paused. Click to resume it')
      : r('stop Reddit loading more posts as you scroll; a load more button appears instead'),
  pageMarker: (page: number): string =>
    r(`the posts from here on were loaded as page ${page} of this feed`),
  dashboardMenu: r('open the dashboard: cards for your subreddits, users, searches and feeds'),
  dashboardClose: r('close the dashboard (Esc)'),
  dashboardSettings: r('open the settings for the dashboard cards'),
  dashboardCard: (title: string): string => r(`open ${title}`),
  dashboardSort: (title: string, sort: string): string => r(`open ${title} sorted by ${sort}`),
  userCardsSwitch: (hidden: boolean): string =>
    hidden
      ? r('Reddit’s hover cards over author names are hidden. Switch on to show them')
      : r('Reddit’s hover cards over author names are shown. Switch off to hide them again'),
  userInSubredditInput: (user: string): string =>
    r(`type a subreddit to search u/${user}’s posts in, such as pics`),
  userInSubredditGo: (user: string): string =>
    r(`search that subreddit for posts by u/${user} (opens Reddit’s search)`),
  xPostLink: (sub: string): string =>
    r(`this post says it was cross-posted from r/${sub}: open it`),

  // --- notices ------------------------------------------------------------------------------------
  noticeRoot: r('a message from REScue'),
  noticeSettings: (title: string): string =>
    r(`open the settings for ${title}, the feature that sent this`),
  noticeName: r('the REScue feature that sent this message'),
  noticeMute: r('tick to stop showing this kind of notice (undo it in settings, Notices)'),
  noticeClose: r('dismiss this notice'),
  noticeAction: (label: string): string => r(label),
  undo: r('reverse the change you just made'),
  unhideRead: r('show the read comments again'),
  hideRead: r('hide the comments you had already read at your last visit'),
  showFiltered: r('show the filtered posts, each marked with its rule'),
  showReasons: r('keep them hidden but list each one with the rule that matched'),
  ageContinue: r('confirm your age on Reddit’s own 18+ prompt'),
  turnOff: r('turn this feature off (you can turn it back on in settings)'),
  keepIt: r('keep this feature on and stop suggesting to turn it off'),

  /** `detail` is built by neutralityFilter/chip.ts: domain, score, what it measures, source. */
  neutralityChip: (detail: string): string => r(detail),

  // --- settings console ----------------------------------------------------------------------------
  consoleClose: r('close the settings console (Esc)'),
  resetOption: (title: string): string => r(`put “${title}” back to its default value`),
  copyKey: r('copy the link to this feature’s settings'),
  rowDrag: (n: number): string =>
    r(`drag row ${n} to reorder it (Alt+↑ / Alt+↓ from the keyboard)`),
  rowUp: (n: number): string => r(`move row ${n} up`),
  rowDown: (n: number): string => r(`move row ${n} down`),
  rowRemove: (n: number): string => r(`delete row ${n}`),
  rowAdd: r('add a new row to this list'),
  promotedCount: r('how many promoted posts and ad slots REScue is hiding on this page'),
  promotedReveal: (revealing: boolean): string =>
    revealing
      ? r('hide the promoted posts and ad slots again')
      : r('show the promoted posts and ad slots on this page, each outlined'),
  // --- media viewer, sizing and link expandos (mediaViewer) -------------------------------------
  filmMore: r('load the next pictures of this gallery'),
  filmSlideshow: r('go back to Reddit’s one-picture-at-a-time gallery for this post'),
  filmStack: r(
    'show every picture of a gallery stacked down the page (a filmstrip), not one at a time',
  ),
  menuFilmstrip: (on: boolean): string =>
    on
      ? r('galleries are stacked as a filmstrip. Click to use Reddit’s slideshow again')
      : r('galleries use Reddit’s slideshow. Click to stack all pictures down the page'),
  playerBack: r('go back to Reddit’s own video player for this post'),
  playerOwn: r('play this video in a plain REScue player instead of Reddit’s'),
  resolution: r('the original size of this picture, in pixels'),
  linkMedia: (shown: boolean): string =>
    shown
      ? r('hide the picture this link points to')
      : r('show the picture this link points to, here'),
  // --- settings console navigation and search -----------------------------------------------------
  consoleSearch: r('search every setting by name, key or description (press / to jump here)'),
  consoleCategory: (title: string): string => r(`show the ${title} settings and their features`),
  consoleBack: (title: string): string => r(`back to the ${title} settings`),
  // --- media inside comments (inlineMedia) -----------------------------------------------------
  commentMediaToggle: (hidden: boolean, kind: string): string =>
    hidden
      ? r(`show this comment's ${kind} (X shows or hides the selected comment's media)`)
      : r(`hide this comment's ${kind} (X hides or shows the selected comment's media)`),
} as const;
