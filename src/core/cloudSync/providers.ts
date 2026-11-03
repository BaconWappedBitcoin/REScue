/** The three providers, with the owner's client ids (config.ts). Only configured ones are offered. */
import { CLOUD_API_HOSTS, ONEDRIVE } from '../../contracts/cloud';
import { cloudFetch } from '../net';
import { createDropboxProvider } from './dropbox';
import { createGoogleProvider } from './google';
import { createOneDriveProvider } from './onedrive';
import type { CloudHttp, CloudProvider, CloudProviderId } from './types';

export function allProviders(): Record<CloudProviderId, CloudProvider> {
  return {
    google: createGoogleProvider(),
    dropbox: createDropboxProvider(),
    onedrive: createOneDriveProvider(),
  };
}

export function configuredProviders(): CloudProvider[] {
  return Object.values(allProviders()).filter((p) => p.configured());
}

export { isProviderId } from './types';

/** The background's HTTP for cloud sync: the narrow gate in net.ts, bound to the allow-list. */
export const cloudHttp: CloudHttp = (url, init) =>
  cloudFetch(url, init, {
    hosts: CLOUD_API_HOSTS,
    downloadSuffixes: ONEDRIVE.downloadHostSuffixes,
  });
