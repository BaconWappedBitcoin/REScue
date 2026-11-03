/**
 * PKCE (RFC 7636) and OAuth `state` values. The verifier is 86 characters of base64url
 * (64 random bytes): inside the RFC's 43..128 range and its unreserved character set.
 */

type RandomSource = (bytes: Uint8Array) => Uint8Array;
const cryptoRandom: RandomSource = (b) => crypto.getRandomValues(b);

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomVerifier(random: RandomSource = cryptoRandom): string {
  return base64url(random(new Uint8Array(64)));
}

/** An unguessable value for `state` (and the per-install device id). */
export function randomId(random: RandomSource = cryptoRandom): string {
  return base64url(random(new Uint8Array(16)));
}

/** code_challenge for method S256: BASE64URL(SHA-256(ASCII(verifier))). */
export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
