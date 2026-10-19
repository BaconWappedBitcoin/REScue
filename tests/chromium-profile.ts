/**
 * Fresh Chromium profiles that do NOT make a failed Windows logon.
 *
 * Chromium 153+ checks whether the Windows account has a blank password by attempting a logon with
 * an empty password, once per profile, and caches the answer in the profile's "Local State"
 * (`password_manager.os_password_blank` / `os_password_last_changed`; Chromium issue 562403601).
 * Every fresh test profile therefore logged one failed logon (event 4625), and a test run — dozens
 * of launches — locked the Windows account under a 10-failures-in-10-minutes lockout policy
 * (seen 2026-10-15/16: 302 failures, 30 lockouts, RDP refused).
 *
 * The fix: run the check ONCE in a seed profile kept in the home folder, then copy the seed's
 * "Local State" into every fresh profile before launch. Verified: a seeded fresh profile adds 0
 * failed logons. The seed is made at most once per machine (one failed logon, ever).
 */
import { chromium } from '@playwright/test';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const SEED_DIR = join(homedir(), '.rescue-chromium-seed');
const SEED_STATE = join(SEED_DIR, 'Local State');

/** True once the seed's Local State records the blank-password answer. */
function seedReady(): boolean {
  if (!existsSync(SEED_STATE)) return false;
  try {
    const s = JSON.parse(readFileSync(SEED_STATE, 'utf8')) as {
      password_manager?: { os_password_last_changed?: unknown };
    };
    return s.password_manager?.os_password_last_changed !== undefined;
  } catch {
    return false;
  }
}

/** Make the seed profile if this machine has none yet (one failed logon, once). */
export async function ensureChromiumSeed(): Promise<void> {
  if (process.platform !== 'win32' || seedReady()) return;
  const ctx = await chromium.launchPersistentContext(SEED_DIR, { channel: 'chromium', headless: true });
  try {
    for (let i = 0; i < 60 && !seedReady(); i++) await new Promise((r) => setTimeout(r, 1000));
  } finally {
    await ctx.close();
  }
  if (!seedReady()) {
    throw new Error(
      `Chromium seed profile at ${SEED_DIR} did not record the blank-password check; refusing to ` +
        'launch fresh profiles, which would each make a failed Windows logon.',
    );
  }
}

/**
 * Copy the seed's Local State into an existing profile folder that has none, so Chromium does not
 * repeat the logon check there.
 */
export function seedProfile(dir: string): void {
  if (process.platform !== 'win32') return;
  if (!seedReady()) {
    throw new Error('Chromium seed missing: call ensureChromiumSeed() first (see tests/chromium-profile.ts).');
  }
  if (!existsSync(join(dir, 'Local State'))) copyFileSync(SEED_STATE, join(dir, 'Local State'));
}

/** A new, empty Chromium profile folder that will not make a failed Windows logon. */
export async function freshProfileDir(prefix: string): Promise<string> {
  await ensureChromiumSeed();
  const dir = mkdtempSync(join(tmpdir(), prefix));
  seedProfile(dir);
  return dir;
}
