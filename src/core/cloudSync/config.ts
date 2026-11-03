/**
 * Cloud sync settings the owner fills in. OAuth CLIENT IDs are public values (they identify the
 * app, they are not secrets) but they do not exist yet: a provider whose id is empty is not
 * offered in the settings console. NEVER put a client secret here; none of the flows uses one.
 *
 * Redirect URIs to register with each provider (one per browser build):
 * - Chrome: `https://<extension-id>.chromiumapp.org/` (the Web Store item's id; chrome.identity
 *   .getRedirectURL()).
 * - Firefox: the value of `browser.identity.getRedirectURL()` for the add-on id
 *   `rescue@rescue-extension`: `https://<sha1-of-add-on-id>.<Firefox redirect domain>/` (seen in
 *   the wild as `….extensions.allizom.org/`; MDN does not name the domain). Read the exact value from the add-on's background console (about:debugging → Inspect →
 *   `browser.identity.getRedirectURL()`); it does not change while the add-on id stays the same.
 *
 * Google (GOOGLE_CLIENT_ID): Google Cloud Console → APIs & Services → enable "Google Drive API";
 *   OAuth consent screen (External, scope `.../auth/drive.appdata`, which is non-sensitive);
 *   Credentials → Create OAuth client ID → type "Web application" → Authorized redirect URIs: the
 *   two above. Copy the client ID (no secret is used: REScue uses the token flow, see google.ts).
 * Dropbox (DROPBOX_APP_KEY): dropbox.com/developers/apps → Create app → Scoped access → "App
 *   folder" → name it; Permissions tab: tick files.content.read and files.content.write, Submit;
 *   Settings tab: OAuth 2 Redirect URIs: the two above; "Allow public clients (Implicit Grant &
 *   PKCE)": Allow. Copy the App key (never the App secret).
 * Microsoft (MICROSOFT_CLIENT_ID): Microsoft Entra admin center → App registrations → New
 *   registration → "Accounts in any organizational directory and personal Microsoft accounts";
 *   Authentication → Add a platform → "Single-page application" → the two redirect URIs above
 *   (type `spa`: the token request from an extension carries an Origin header); API permissions →
 *   Microsoft Graph → Delegated → Files.ReadWrite.AppFolder and offline_access. Copy the
 *   Application (client) ID. The application name becomes the OneDrive app folder's name.
 */
export const GOOGLE_CLIENT_ID = '';
export const DROPBOX_APP_KEY = '';
export const MICROSOFT_CLIENT_ID = '';

/** A cloud file larger than this is refused (both directions), with a clear error. */
export const CLOUD_MAX_BYTES = 512 * 1024;
/** Background schedule: periodic pull, and the pause after a local change before pushing. */
export const CLOUD_PERIOD_MINUTES = 15;
export const CLOUD_DEBOUNCE_MS = 10_000;
/** Refresh an access token this long before it expires. */
export const CLOUD_TOKEN_SLACK_MS = 60_000;
/** Back-off when the provider gives no Retry-After: doubles per failure, capped. */
export const CLOUD_BACKOFF_BASE_MS = 30_000;
export const CLOUD_BACKOFF_MAX_MS = 60 * 60_000;
