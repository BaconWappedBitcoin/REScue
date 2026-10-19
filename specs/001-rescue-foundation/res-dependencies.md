<!-- Generated 2026-10-15 from REA (rea-agents analyze-javascript-application) on RES with Flow types stripped; see research.md R18. Directory imports resolved by path. RES is GPL-3.0, (c) the RES contributors. -->

# RES module dependencies (REA static import graph, Flow types stripped)

## RESTips
- jquery
- lib/constants/urlHashes: RES_SETTINGS_HASH
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: i18n, Storage
- lib/modules/keyboardNav: *
- lib/modules/menu: *
- lib/modules/penaltyBox: *
- lib/modules/settingsNavigation: *
- lib/utils: string, niceKeyCode, CreateElement, elementInViewport, DAY, mutex, positiveModulo
- lib/vendor/guiders.js: guiders
- lodash-es: memoize, random, clamp, once

## about
- lib/core/module: Module
- lib/utils: CreateElement

## accountSwitcher
- lib/core/module: Module
- lib/environment: ajax, multicast, i18n, Permissions
- lib/modules/commandLine: *
- lib/modules/hover: *
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/utils: addFloater, formatDateDiff, getUserInfo, BodyClasses, loggedInUser, isLoggedIn, mutex, string, Alert, formatDate
- lodash-es: once, without

## announcements
- lib/core/metadata: *
- lib/core/module: Module
- lib/environment: openNewTab, i18n, ajax, Storage
- lib/modules/menu: *
- lib/utils: isCurrentSubreddit, string, DAY, addFloater, CreateElement, HOUR
- lodash-es: once

## autoHide
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: isPrivateBrowsing
- lib/modules/readComments: *
- lib/utils: isPageType, Thing, batch, isLoggedIn, watchForThings
- lib/utils/thingHide: *

## backupAndRestore
- lib/core/module: Module
- lib/environment: multicast, Storage, i18n, locale
- lib/environment/foreground/messaging: sendMessage
- lib/modules/backupAndRestore/providers: *
- lib/modules/backupAndRestore/serialization: serialize, deserialize
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/utils: Alert, HOUR, formatDateTime

## betteReddit
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: i18n
- lib/modules/hosts/youtube
- lib/modules/showImages/expando: Expando
- lib/modules/subredditManager: *
- lib/utils: addCSS, string, formatDateDiff, fromSecondsToTime, watchForElements, isPageType, Thing, CreateElement, watchForThings, unhide, Alert, loggedInUser, hide
- lib/utils/dom: _addHeaderId
- lodash-es: debounce

## commandLine
- dompurify
- lib/core/module: Module
- lib/environment: openNewTab, Storage, XhrCache, ajax
- lib/modules/menu: *
- lib/utils: NAMED_KEYS, currentUserProfile, loggedInUser, downcast, string, Alert, currentMultireddit, currentSubreddit, empty
- lodash-es: once

## commentDepth
(RES module only; REScue retired its commentDepth module in T149.)
- jquery
- lib/core/module: Module
- lib/utils: regexes, Thing, execRegexes

## commentHidePersistor
- jquery
- lib/core/module: Module
- lib/environment: Storage
- lib/utils: Thing, watchForThings, maybePruneOldEntries, execRegexes

## commentNavigator
- lib/core/module: Module
- lib/core/options: *
- lib/modules/commandLine: *
- lib/modules/filteReddit/cases: *
- lib/modules/userInfo: *
- lib/modules/wheelBrowse: *
- lib/utils: isCurrentSubreddit, downcast, string, caseBuilder, watchForThings, frameThrottle, empty, SelectedThing, waitForDescendant, addFloater, filterMap, Thing
- lodash-es: memoize, once

## commentPreview
- dompurify
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: ajax
- lib/modules/commentTools: *
- lib/modules/keyboardNav: *
- lib/modules/settingsNavigation: *
- lib/utils: empty, isPageType, currentSubreddit, checkKeysForEvent, string, downcast, NAMED_KEYS
- lodash-es: once, debounce
- snudown-js: markdownWiki, markdown

## commentQuickCollapse
- jquery
- lib/core/module: Module
- lib/utils: click, SelectedThing, addCSS, Thing
- lodash-es: clamp

## commentSortBy
- lib/core/module: Module
- lib/utils: string, watchForRedditEvents

## commentStyle
- lib/core/module: Module
- lib/utils: addCSS

## commentTools
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: i18n, ajax
- lib/modules/accountSwitcher: *
- lib/modules/settingsNavigation: *
- lib/modules/submitIssue: *
- lib/modules/userTagger: *
- lib/utils: escapeHTML, regexes, checkKeysForEvent, currentSubreddit, isPageType, click, NAMED_KEYS, string, DAY, isCurrentSubreddit, niceKeyCode, loggedInUser, Thing, Alert, range, empty
- lodash-es: memoize, once, debounce

## context
- jquery
- lib/core/module: Module
- lib/utils: isPageType, watchForThings, regexes, string
- lodash-es: once

## contribute
- lib/core/module: Module
- lib/environment: i18n, openNewTab
- lib/modules/menu: *
- lib/utils: string

## customToggles
- jquery
- lib/core/module: Module
- lib/core/options: *
- lib/environment: multicast
- lib/modules/commandLine: *
- lib/modules/menu: *
- lib/utils: string, CreateElement, frameThrottle
- lodash-es: once, sortBy

## dashboard
- jquery
- lib/core/module: Module
- lib/environment: ajax, i18n, Storage
- lib/modules/menu: *
- lib/modules/notifications: *
- lib/utils: loggedInUser, isAppType, string, CreateElement, addDashboardTab, Alert, registerPage, formatDateTime
- lib/vendor: Sortable
- lodash-es: once

## disableChat
- lib/core/module: Module
- lib/utils: stopPageContextScript

## easterEgg
- jquery
- lib/core/module: Module
- lib/modules/notifications: *

## filteReddit
- lib/core/module: Module
- lib/core/options: *
- lib/environment: i18n, Storage, context, ajax
- lib/modules/RESTips: *
- lib/modules/commandLine: *
- lib/modules/customToggles: *
- lib/modules/filteReddit/Case: Case
- lib/modules/filteReddit/ExternalFilter: ExternalFilter
- lib/modules/filteReddit/Filterline: Filterline
- lib/modules/filteReddit/cases: *
- lib/modules/notifications: *
- lib/utils: waitForDescendant, extendDeep, currentDomain, isPageType, scrollToElement, isCurrentSubreddit, mutex, BodyClasses, CreateElement, isAppType, currentSubreddit, isCurrentMultireddit, fullLocation, currentUserProfile, batch, string, indexOptionTable, watchForThings, SelectedThing
- lodash-es: sortBy, isEmpty, groupBy, memoize, pull, once, zip, difference
- snudown-js: markdown

## hideChildComments
- lib/core/module: Module
- lib/environment: i18n
- lib/utils: watchForThings, forEachChunked
- lodash-es: once

## hover
- jquery
- lib/core/module: Module
- lib/core/options: *
- lib/utils: getViewportSize, waitForDetach, NAMED_KEYS, waitForEvent, frameThrottle

## index
- lib/modules/RESTips: module
- lib/modules/about: module
- lib/modules/accountSwitcher: module
- lib/modules/announcements: module
- lib/modules/autoHide: module
- lib/modules/backupAndRestore: module
- lib/modules/betteReddit: module
- lib/modules/commandLine: module
- lib/modules/commentDepth: module
- lib/modules/commentHidePersistor: module
- lib/modules/commentNavigator: module
- lib/modules/commentPreview: module
- lib/modules/commentQuickCollapse: module
- lib/modules/commentSortBy: module
- lib/modules/commentStyle: module
- lib/modules/commentTools: module
- lib/modules/context: module
- lib/modules/contribute: module
- lib/modules/customToggles: module
- lib/modules/dashboard: module
- lib/modules/disableChat: module
- lib/modules/easterEgg: module
- lib/modules/filteReddit: module
- lib/modules/hideChildComments: module
- lib/modules/hover: module
- lib/modules/keyboardNav: module
- lib/modules/localDate: module
- lib/modules/logoLink: module
- lib/modules/menu: module
- lib/modules/messageMenu: module
- lib/modules/modhelper: module
- lib/modules/multiredditNavbar: module
- lib/modules/neverEndingComments: module
- lib/modules/neverEndingReddit: module
- lib/modules/newCommentCount: module
- lib/modules/nightMode: module
- lib/modules/noParticipation: module
- lib/modules/notifications: module
- lib/modules/onboarding: module
- lib/modules/orangered: module
- lib/modules/pageNavigator: module
- lib/modules/penaltyBox: module
- lib/modules/presets: module
- lib/modules/profileNavigator: module
- lib/modules/profileRedirect: module
- lib/modules/quarantineHide: module
- lib/modules/quickMessage: module
- lib/modules/readComments: module
- lib/modules/redditUserInfo: module
- lib/modules/requestPermissions: module
- lib/modules/saveComments: module
- lib/modules/search: module
- lib/modules/searchHelper: module
- lib/modules/selectedEntry: module
- lib/modules/settingsNavigation: module
- lib/modules/showImages: module
- lib/modules/showKarma: module
- lib/modules/showParent: module
- lib/modules/singleClick: module
- lib/modules/sourceSnudown: module
- lib/modules/spamButton: module
- lib/modules/spoilerTags: module
- lib/modules/styleTweaks: module
- lib/modules/stylesheet: module
- lib/modules/submitHelper: module
- lib/modules/submitIssue: module
- lib/modules/subredditInfo: module
- lib/modules/subredditManager: module
- lib/modules/subredditStyleToggle: module
- lib/modules/subredditTagger: module
- lib/modules/tableTools: module
- lib/modules/temporaryDropdownLinks: module
- lib/modules/troubleshooter: module
- lib/modules/userHighlight: module
- lib/modules/userInfo: module
- lib/modules/userTagger: module
- lib/modules/userbarHider: module
- lib/modules/usernameHider: module
- lib/modules/version: module
- lib/modules/voteEnhancements: module
- lib/modules/wheelBrowse: module
- lib/modules/xPostLinks: module

## keyboardNav
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: i18n, openNewTab
- lib/modules/commandLine: *
- lib/modules/commentNavigator: *
- lib/modules/easterEgg: *
- lib/modules/filteReddit: *
- lib/modules/hideChildComments: *
- lib/modules/neverEndingReddit: *
- lib/modules/noParticipation: *
- lib/modules/notifications: *
- lib/modules/saveComments: *
- lib/modules/settingsNavigation: *
- lib/modules/showImages: *
- lib/modules/showParent: *
- lib/modules/singleClick: *
- lib/utils: isCommentCode, scrollToElement, loggedInUser, waitForEvent, currentSubreddit, Thing, NAMED_KEYS, downcast, filterMap, isEmptyLink, click, string, watchForElements, SelectedThing, currentUserProfile, matchesPageLocation, niceKeyCode, hashKeyEvent, hashKeyArray, isPageType, getPercentageVisibleYAxis
- lodash-es: memoize, once, without, maxBy

## localDate
- jquery
- lib/core/module: Module

## logoLink
- jquery
- lib/core/module: Module

## menu
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: i18n
- lib/modules/commandLine: *
- lib/modules/hover: *
- lib/modules/settingsNavigation: *
- lib/utils: string, addFloater

## messageMenu
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: i18n
- lib/modules/hover: *
- lib/modules/quickMessage: *
- lib/modules/settingsNavigation: *
- lib/utils: string

## modhelper
- jquery
- lib/core/module: Module
- lib/modules/settingsNavigation: *
- snudown-js: markdown

## multiredditNavbar
- lib/core/module: Module
- lib/environment: i18n
- lib/modules/hover: *
- lib/modules/penaltyBox: *
- lib/modules/settingsNavigation: *
- lib/utils: string

## neverEndingComments
- lib/core/module: Module
- lib/utils: Thing, watchForDescendants, waitForDetach, frameDebounce, SelectedThing, mutex

## neverEndingReddit
- lib/constants/urlHashes: RES_NER_PAGE_HASH
- lib/core/module: Module
- lib/environment: context, ajax, Storage
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/utils: scrollToElement, documentLoggedInUser, HOUR, addCSS, registerPage, isCurrentSubreddit, SelectedThing, empty, Thing, string, addFloater, PagePhases
- lodash-es: once, memoize

## newCommentCount
- jquery
- lib/core/module: Module
- lib/environment: isPrivateBrowsing, Storage
- lib/modules/notifications: *
- lib/utils: string, addDashboardTab, regexes, escapeHTML, watchForThings, Table, formatDateTime, MINUTE, mutex, waitForEvent, Thing, formatRelativeTime, maybePruneOldEntries, execRegexes, getPostMetadata, waitForDescendant, empty, isPageType, DAY, loggedInUser
- lodash-es: memoize

## nightMode
- lib/core/init: *
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: i18n, Storage, Session
- lib/modules/customToggles: *
- lib/utils: PagePhases, Alert, waitForChild, appType, BodyClasses, HOUR, currentSubreddit
- lodash-es: pull
- suncalc: getTimes

## noParticipation
- jquery
- lib/core/module: Module
- lib/modules/commentTools: *
- lib/modules/notifications: *
- lib/utils: click, downcast, loggedInUser, isPageType, BodyClasses
- lodash-es: once

## notifications
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: Storage, i18n
- lib/modules/settingsNavigation: *
- lib/utils: firstValid, string, hashCode, waitForEvent
- lodash-es: once

## onboarding
- lib/core/metadata: *
- lib/core/module: Module
- lib/environment: openNewTab, i18n, Storage
- lib/modules/notifications: *
- lib/utils: filterMap
- semver/functions/diff
- semver/functions/gt

## orangered
- favico.js
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: multicast, Session
- lib/images/legacyFavicon.png
- lib/modules/betteReddit: *
- lib/utils: loggedInUser, addFloater
- lodash-es: once

## pageNavigator
- jquery
- lib/core/module: Module
- lib/environment: i18n
- lib/modules/settingsNavigation: *
- lib/utils: string, watchForThings, getHeaderOffset, SelectedThing, frameThrottle, scrollToElement, addFloater, isPageType
- lodash-es: once

## penaltyBox
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: i18n
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lodash-es: clamp

## presets
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: i18n
- lib/modules/notifications: *
- lib/modules/troubleshooter: *

## profileNavigator
- lib/core/module: Module
- lib/environment: i18n
- lib/modules/hover: *
- lib/modules/penaltyBox: *
- lib/modules/settingsNavigation: *
- lib/utils: loggedInUser, string

## profileRedirect
- lib/core/module: Module
- lib/environment: i18n
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/utils: regexes, WEEK, isPageType, string

## quarantineHide
- jquery
- lib/core/module: Module
- lib/utils: inQuarantinedSubreddit, BodyClasses, watchForThings, frameThrottle

## quickMessage
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: Storage, ajax
- lib/modules/commandLine: *
- lib/modules/commentTools: *
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/modules/usernameHider: *
- lib/utils: checkKeysForEvent, downcast, isModeratorAnywhere, regexes, NAMED_KEYS, loggedInUser, string, HOUR, currentSubreddit
- lodash-es: once

## readComments
- lib/core/module: Module
- lib/environment: isPrivateBrowsing, Storage
- lib/modules/filteReddit: *
- lib/modules/notifications: *
- lib/utils: SelectedThing, execRegexes, Thing, batch, maybePruneOldEntries, watchForThings

## redditUserInfo
- lib/core/module: Module

## requestPermissions
- lib/core/module: Module

## saveComments
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: Storage, i18n
- lib/modules/keyboardNav: *
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/utils: watchForThings, addDashboardTab, niceKeyCode, WEEK, Thing, preventCloning, formatDateDiff, string, formatDateTime, formatDate, isPageType, CreateElement
- lodash-es: once
- snudown-js: markdown

## search
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: i18n
- lib/modules/settingsNavigation: *
- lib/utils: downcast, CreateElement, string, Alert, empty
- lodash-es: memoize, once, isEmpty
- snudown-js: markdown

## searchHelper
- jquery
- lib/core/module: Module
- lib/utils: isPageType, regexes, BodyClasses, Thing, downcast, string

## selectedEntry
- jquery
- lib/core/module: Module
- lib/utils: click, Thing, addCSS, SelectedThing
- lodash-es: throttle

## settingsNavigation
- lib/constants/urlHashes: RES_SETTINGS_HASH
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: i18n, isOptionsPage, context, openNewTab, getOptionsURL
- lib/modules/commandLine: *
- lib/modules/menu: *
- lib/utils: string

## showImages
- dompurify
- jquery
- lib/core/host: Host
- lib/core/init: loadOptions
- lib/core/module: Module
- lib/core/modules: *
- lib/core/options: *
- lib/environment: openNewTab, addURLToHistory, Permissions, loadScript, download, isPrivateBrowsing, Storage, ajax
- lib/modules/hosts: *
- lib/modules/hosts/vreddit
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/modules/showImages/expando: expandos, activeExpandos, Expando
- lib/modules/showImages/templates: siteAttributionTemplate, imageTemplate, audioTemplate, crosspostMetadataTemplate, iframeTemplate, videoTemplate, textTemplate, galleryTemplate, mediaControlsTemplate
- lib/utils: filterMap, isPageType, watchForRedditEvents, getViewportSize, watchForThings, positiveModulo, batch, getPercentageVisibleYAxis, stopPageContextScript, addCSS, Thing, isAppType, empty, scrollToElement, elementInViewport, waitForEvent, frameThrottle, watchForElements, SelectedThing, CreateElement, downcast, forEachSeq, idleThrottle, string, PagePhases
- lodash-es: pull, without, intersection, memoize, once

## showKarma
- lib/core/module: Module
- lib/utils: formatNumber, string, getUserInfo, formatDateDiff, empty, formatDate, loggedInUser

## showParent
- jquery
- lib/core/module: Module
- lib/modules/hover: *
- lib/utils: Thing

## singleClick
- lib/core/module: Module
- lib/environment: openNewTabs
- lib/utils: watchForThings, string

## sourceSnudown
- jquery
- lib/core/module: Module
- lib/environment: ajax
- lib/utils: preventCloning, keyedMutex, string, watchForThings, regexes
- lodash-es: once

## spamButton
- lib/core/module: Module
- lib/utils: watchForThings

## spoilerTags
- lib/core/module: Module

## styleTweaks
- lib/core/module: Module
- lib/utils: addCSS

## stylesheet
- jquery
- lib/core/module: Module
- lib/modules/customToggles: *
- lib/utils: string, currentMultireddit, BodyClasses, filterMap, loggedInUser, currentUserProfile, currentSubreddit
- lodash-es: difference

## submitHelper
- jquery
- lib/core/module: Module
- lib/environment: i18n, ajax
- lib/modules/commandLine: *
- lib/modules/settingsNavigation: *
- lib/utils: isPageType, waitForEvent, string, waitForDescendant, isAppType, formatDateDiff
- lodash-es: once, debounce

## submitIssue
- jquery
- lib/core/metadata: *
- lib/core/module: Module
- lib/environment: ajax
- lib/modules/nightMode: *
- lib/modules/settingsNavigation: *
- lib/utils: string, regexes, BrowserDetect
- lib/vendor/guiders.js: guiders
- lodash-es: once

## subredditInfo
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: i18n, ajax
- lib/modules/dashboard: *
- lib/modules/filteReddit: *
- lib/modules/hover: *
- lib/modules/subredditManager: *
- lib/utils: formatDateDiff, string, formatDate, regexes, CreateElement, isFakeSubreddit, formatNumber, HOUR, loggedInUser

## subredditManager
- dompurify
- jquery
- lib/core/module: Module
- lib/environment: i18n, isPrivateBrowsing, ajax, Session, Storage
- lib/modules/notifications: *
- lib/modules/settingsNavigation: *
- lib/utils: waitForDescendant, empty, PagePhases, downcast, formatRelativeTime, fullLocation, formatDate, currentSubreddit, loggedInUser, Alert, waitForEvent, DAY, click, isLoggedIn, watchForThings, string, regexes, Table, NAMED_KEYS, isCurrentSubreddit, CreateElement
- lodash-es: throttle, once, debounce, pull

## subredditStyleToggle
- lib/core/module: Module
- lib/environment: i18n, Storage, PageAction
- lib/modules/customToggles: *
- lib/modules/nightMode: *
- lib/utils: BodyClasses, mutex, waitForDescendant, PagePhases, currentSubreddit, waitForChild, asyncSome, string
- lodash-es: once

## subredditTagger
- jquery
- lib/core/module: Module
- lib/utils: watchForThings, escapeHTML

## tableTools
- jquery
- lib/core/module: Module
- lib/utils: Table

## temporaryDropdownLinks
- lib/core/module: Module
- lib/environment: i18n
- lib/utils: string, downcast

## troubleshooter
- lib/constants/localStorage: CACHED_MESSAGES_TOKEN_KEY, CACHED_LANG_KEY, CACHED_MESSAGES_KEY
- lib/constants/urlHashes: RES_DISABLED_HASH
- lib/core/module: Module
- lib/environment: XhrCache, multicast, Session, i18n, Storage, isPrivateBrowsing, context
- lib/modules/notifications: *
- lib/modules/userTagger: *
- lib/utils: Alert

## userHighlight
- lib/core/module: Module
- lib/core/options: *
- lib/environment: i18n
- lib/modules/userInfo: *
- lib/utils: isPageType, watchForElements, getUsernameFromLink, Thing, addCSS, watchForThings, Alert, loggedInUser, hashCode, throttle

## userInfo
- jquery
- lib/core/module: Module
- lib/core/modules: *
- lib/environment: i18n, ajax
- lib/modules/commentNavigator: *
- lib/modules/hover: *
- lib/modules/quickMessage: *
- lib/modules/userHighlight: *
- lib/modules/userTagger: *
- lib/utils: usernameSelector, loggedInUser, Thing, string, click, downcast, getUserInfo, formatDateDiff, formatDate, getUsernameFromLink, CreateElement, formatNumber

## userTagger
- jquery
- lib/core/module: Module
- lib/core/options: *
- lib/environment: openNewTabs, Storage, i18n
- lib/modules/commandLine: *
- lib/modules/filteReddit: *
- lib/modules/hover: *
- lib/modules/nightMode: *
- lib/modules/notifications: *
- lib/utils: Thing, CreateElement, string, watchForElements, Alert, watchForThings, preventCloning, empty, addDashboardTab, getUsernameFromLink, watchForRedditEvents, loggedInUser, Table, downcast, SelectedThing, isAppType, usernameSelector, isPageType
- lodash-es: pickBy, pull, once

## userbarHider
- jquery
- lib/core/module: Module
- lib/core/options: *
- lib/environment: i18n
- lib/modules/notifications: *
- lib/utils: BodyClasses

## usernameHider
- jquery
- lib/core/module: Module
- lib/modules/accountSwitcher: *
- lib/utils: loggedInUser, addCSS, regexes
- lodash-es: once

## version
- jquery
- lib/core/metadata: *
- lib/core/module: Module
- lib/environment: getExtensionId
- lib/utils: BodyClasses, string, range
- lodash-es: uniqBy

## voteEnhancements
- lib/core/module: Module
- lib/utils: projectInto, addCSS, colorFromArray, watchForThings, colorToArray, zip
- lodash-es: zipWith

## wheelBrowse
- lib/core/module: Module
- lib/modules/settingsNavigation: *
- lib/modules/showImages/expando: Expando
- lib/utils: SelectedThing, addFloater, string, isPageType

## xPostLinks
- jquery
- lib/core/module: Module
- lib/environment: i18n
- lib/utils: string, watchForThings

