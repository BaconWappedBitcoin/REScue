/**
 * Cloud storage providers for the opt-in "Sync across browsers" feature (src/core/cloudSync/).
 * Every address and parameter here comes from the provider's official documentation, cited per
 * entry (checked 2026-11). These are the ONLY hosts the cloud path in src/core/net.ts may reach.
 * A provider is offered only when its client id in src/core/cloudSync/config.ts is filled in.
 */

/** The one file REScue keeps in the provider's app-only folder. */
export const CLOUD_FILE_NAME = 'rescue-sync.json';

export type CloudProviderId = 'google' | 'dropbox' | 'onedrive';

/**
 * Google Drive, hidden application data folder.
 * - OAuth (token flow, see google.ts for why): https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow
 *   authorize `https://accounts.google.com/o/oauth2/v2/auth` (client_id, redirect_uri,
 *   response_type=token, scope, state, prompt=none for silent renewal); revoke
 *   `POST https://oauth2.googleapis.com/revoke` with form field `token`.
 * - appDataFolder and its scope: https://developers.google.com/workspace/drive/api/guides/appdata
 * - files.list `GET https://www.googleapis.com/drive/v3/files` (spaces=appDataFolder, q, fields):
 *   https://developers.google.com/workspace/drive/api/guides/search-files
 * - download `GET .../drive/v3/files/{id}?alt=media`: guides/appdata (same page)
 * - create `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`
 *   (multipart/related, metadata part first): https://developers.google.com/workspace/drive/api/guides/manage-uploads
 * - update `PATCH https://www.googleapis.com/upload/drive/v3/files/{fileId}?uploadType=media`:
 *   https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update
 */
export const GOOGLE = {
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  revoke: 'https://oauth2.googleapis.com/revoke',
  files: 'https://www.googleapis.com/drive/v3/files',
  upload: 'https://www.googleapis.com/upload/drive/v3/files',
  scope: 'https://www.googleapis.com/auth/drive.appdata',
  appFolder: 'appDataFolder',
  /** Origins asked for as optional host permissions when the user connects Google Drive. */
  origins: ['https://www.googleapis.com/*', 'https://oauth2.googleapis.com/*'],
  hosts: ['www.googleapis.com', 'oauth2.googleapis.com'],
} as const;

/**
 * Dropbox, "App folder" access type (the app sees only /Apps/<app name>/).
 * - OAuth guide (authorize URL, PKCE with S256, token_access_type=offline, refresh with
 *   grant_type=refresh_token): https://docs.dropboxapi.com/dropbox-api/docs/oauth
 * - token endpoint `https://api.dropboxapi.com/oauth2/token` and the PKCE token/refresh fields
 *   (client_id + code_verifier, no secret): official SDK, https://github.com/dropbox/dropbox-sdk-js
 *   src/auth.js and src/utils.js (OAuth2TokenUrl = api host + /oauth2/token).
 * - files/upload (host "content", style "upload", WriteMode overwrite, mute), files/download
 *   (host "content", style "download") and auth/token/revoke (host "api", no arguments): the
 *   official API spec, https://github.com/dropbox/dropbox-api-spec files.stone and auth.stone.
 *   Content-host calls take their arguments as JSON in the `Dropbox-API-Arg` header, with
 *   characters 0x7F and above escaped as \uXXXX (SDK utils.js httpHeaderSafeJson).
 * - Scopes the app must have ticked: files.content.read, files.content.write (files.stone).
 */
export const DROPBOX = {
  authorize: 'https://www.dropbox.com/oauth2/authorize',
  token: 'https://api.dropboxapi.com/oauth2/token',
  revoke: 'https://api.dropboxapi.com/2/auth/token/revoke',
  upload: 'https://content.dropboxapi.com/2/files/upload',
  download: 'https://content.dropboxapi.com/2/files/download',
  /** Inside the app folder: the folder itself is the root for an App-folder app. */
  path: `/${CLOUD_FILE_NAME}`,
  origins: ['https://api.dropboxapi.com/*', 'https://content.dropboxapi.com/*'],
  hosts: ['api.dropboxapi.com', 'content.dropboxapi.com'],
} as const;

/**
 * OneDrive through Microsoft Graph, the app's special folder `approot`.
 * - Microsoft identity platform auth code flow with PKCE, public client (no secret), `common`
 *   tenant, `offline_access` for a refresh token; a redirect URI of type `spa` is required for a
 *   token request that carries an Origin header, and its refresh token lasts 24 hours:
 *   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 * - App folder and `Files.ReadWrite.AppFolder`, path addressing under
 *   `/me/drive/special/approot:/{name}:/content`:
 *   https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/special-folders-appfolder
 * - upload (PUT .../content, Content-Type text/plain, up to 250 MB):
 *   https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0
 * - download: `/content` answers 302 to a pre-authenticated URL; JavaScript apps select
 *   `@microsoft.graph.downloadUrl` and fetch that URL without an Authorization header:
 *   https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0
 * There is no token revocation endpoint for a public client; disconnecting forgets the tokens.
 */
export const ONEDRIVE = {
  authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  item: `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${CLOUD_FILE_NAME}`,
  content: `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${CLOUD_FILE_NAME}:/content`,
  scope: 'Files.ReadWrite.AppFolder offline_access',
  origins: ['https://login.microsoftonline.com/*', 'https://graph.microsoft.com/*'],
  hosts: ['login.microsoftonline.com', 'graph.microsoft.com'],
  /**
   * Hosts a pre-authenticated download URL may point to. The Graph page shows
   * `*.files.1drv.com`; personal accounts are also served from `*.microsoftpersonalcontent.com`
   * and work accounts from `*.sharepoint.com` (NOT confirmed by the cited page: verify with a
   * real account). These are reached without host permission (the URL is CORS-enabled, per the
   * page above), without credentials, and only by a GET without an Authorization header.
   */
  downloadHostSuffixes: ['.files.1drv.com', '.microsoftpersonalcontent.com', '.sharepoint.com'],
} as const;

/** Exact API hosts the background's cloud path may contact with a token. */
export const CLOUD_API_HOSTS: readonly string[] = [
  ...GOOGLE.hosts,
  ...DROPBOX.hosts,
  ...ONEDRIVE.hosts,
];

export const CLOUD_PROVIDER_ORIGINS: Record<CloudProviderId, readonly string[]> = {
  google: GOOGLE.origins,
  dropbox: DROPBOX.origins,
  onedrive: ONEDRIVE.origins,
};

export const CLOUD_PROVIDER_LABELS: Record<CloudProviderId, string> = {
  google: 'Google Drive',
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
};
