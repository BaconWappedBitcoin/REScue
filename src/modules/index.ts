/**
 * Module index: every feature module is registered here. Each declares `resId` where it
 * corresponds to an RES module, so feature-matrix.md can be checked against it (T118).
 */
import type { ModuleDefinition } from '../core/types';
import { backupRestore } from './core/backupRestore';
import { resImport } from './core/resImport';
import { commandLine } from './core/commandLine';
import { customToggles, presets } from './core/presets';
import { noticeSettings } from './core/noticeSettings';
import { hoverSettings } from './core/hoverSettings';
import { quickToggles } from './core/quickToggles';
import { settingsConsole } from './core/settingsConsole';
import { about, troubleshooter } from './core/troubleshooter';
import { singleClick, wheelBrowse } from './listings/browsing';
import { filteReddit } from './listings/filteReddit';
import { neutralityFilter } from './listings/neutralityFilter';
import { interstitials } from './listings/interstitials';
import { keyboardNav } from './listings/keyboardNav';
import { keyboardActions } from './actions/keyboardActions';
import { voteEnhancements } from './actions/voteEnhancements';
import { oldRedditRedirect, profileRedirect, quarantineHide } from './listings/listingTweaks';
import { commentQuickCollapse } from './comments/commentQuickCollapse';
import { commentStyle } from './comments/commentStyle';
import { showKarma } from './users/showKarma';
import { commentHidePersistor } from './comments/commentHidePersistor';
import { commentNavigator } from './comments/commentNavigator';
import { commentSortBy } from './comments/commentSortBy';
import { hideChildComments } from './comments/hideChildComments';
import { newCommentCount } from './comments/newCommentCount';
import { readComments } from './comments/readComments';
import { saveComments } from './comments/saveComments';
import { showParent } from './comments/showParent';
import { tableTools } from './comments/tableTools';
import { threadSubscriptions } from './comments/threadSubscriptions';
import { autoHide } from './listings/autoHide';
import { feedPause } from './listings/feedPause';
import { hidePromoted } from './listings/hidePromoted';
import { hideLinks } from './listings/hideLinks';
import { xPostLinks } from './listings/xPostLinks';
import { linksNewTab } from './comments/linksNewTab';
import { headerButton } from './appearance/headerButton';
import { subredditTagger } from './listings/subredditTagger';
import { inlineMedia } from './listings/inlineMedia';
import { mediaViewer } from './listings/inlineMedia/viewer';
import { keyboardNavExtras } from './listings/keyboardNavExtras';
import { penaltyBox } from './users/penaltyBox';
import { hoverCardActions } from './users/hoverCardActions';
import { userHighlight } from './users/userHighlight';
import { userTagger } from './users/userTagger';
import { customCss } from './appearance/customCss';
import { dashboard } from './appearance/dashboard';
import { disableChat } from './appearance/disableChat';
import { easterEgg } from './appearance/easterEgg';
import { profileNavigator } from './appearance/profileNavigator';
import { redditUserInfo } from './users/redditUserInfo';
import { localDate } from './appearance/localDate';
import { logoLink } from './appearance/logoLink';
import { oldRedditSkin } from './appearance/oldRedditSkin';
import { pageNavigator } from './appearance/pageNavigator';
import { searchHelper } from './appearance/searchHelper';
import { styleTweaks } from './appearance/styleTweaks';
import { subredditManager } from './appearance/subredditManager';
import { usernameHider } from './appearance/usernameHider';

export const MODULES: ModuleDefinition[] = [
  settingsConsole,
  backupRestore,
  resImport,
  presets,
  customToggles,
  quickToggles,
  noticeSettings,
  hoverSettings,
  troubleshooter,
  about,
  interstitials,
  commandLine,
  // Before keyboardNav: its C (hide child comments) must get first refusal on a selected comment.
  hideChildComments,
  keyboardNav,
  keyboardNavExtras,
  keyboardActions,
  wheelBrowse,
  singleClick,
  feedPause,
  hidePromoted,
  quarantineHide,
  profileRedirect,
  oldRedditRedirect,
  penaltyBox,
  userTagger,
  userHighlight,
  hoverCardActions,
  // US6. readComments first: newCommentCount, autoHide and commentNavigator read its store.
  readComments,
  newCommentCount,
  commentNavigator,
  commentHidePersistor,
  showParent,
  saveComments,
  commentQuickCollapse,
  commentStyle,
  showKarma,
  commentSortBy,
  tableTools,
  linksNewTab,
  autoHide,
  subredditTagger,
  // After the tag, so its "show image" word follows it in the credit bar.
  inlineMedia,
  mediaViewer,
  xPostLinks,
  // US8 appearance.
  customCss,
  localDate,
  usernameHider,
  subredditManager,
  pageNavigator,
  logoLink,
  headerButton,
  searchHelper,
  dashboard,
  profileNavigator,
  redditUserInfo,
  easterEgg,
  disableChat,
  styleTweaks,
  oldRedditSkin,
  // After the time labels (local date, tags): its “subscribe” word follows the time it relates to.
  threadSubscriptions,
  // Its “hide” word goes in the credit bar after the time too, before the score label.
  hideLinks,
  // Last, so its tagline label follows the ones that explain the time (local date, [l+c], tags).
  voteEnhancements,
  // After every label, so the ⊘ filter button is the last thing in a post's credit bar.
  filteReddit,
  neutralityFilter,
] as ModuleDefinition[];
