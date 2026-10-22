/** Isolated-world side of the bridge: request/response with timeouts (contracts/messaging.md). */
import {
  CHANNEL_ATTR,
  REF_ATTR,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  type BridgeRequest,
  type BridgeResponse,
  type Envelope,
} from './bridge-protocol';
import { currentToken } from './instance';

const DEFAULT_TIMEOUT_MS = 5000;

const randomToken = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export class BridgeClient {
  private readonly token = randomToken();
  private nextId = 1;
  private readonly pending = new Map<number, (r: BridgeResponse) => void>();
  private refSeq = 0;

  constructor(private readonly win: Window = window) {
    win.document.documentElement.setAttribute(CHANNEL_ATTR, this.token);
    win.addEventListener(RESPONSE_EVENT, (e) => {
      let env: Envelope<BridgeResponse>;
      try {
        env = JSON.parse(String((e as CustomEvent).detail));
      } catch {
        return;
      }
      if (env.token !== this.token) return;
      const resolve = this.pending.get(env.id);
      if (resolve) {
        this.pending.delete(env.id);
        resolve(env.body);
      }
    });
  }

  /**
   * Stamp (or reuse) a reference on an element so the MAIN world can find it. Refs carry the page
   * instance's token (core/instance.ts): after an add-on reload in an open tab a new client numbers
   * from 1 again, and a bare "r1" could find an element an older instance stamped. Only this
   * instance's own refs are reused.
   */
  ref(el: Element): string {
    const token = currentToken();
    const prefix = token ? `${token}-r` : 'r';
    let r = el.getAttribute(REF_ATTR);
    if (!r?.startsWith(prefix)) {
      r = `${prefix}${++this.refSeq}`;
      el.setAttribute(REF_ATTR, r);
    }
    return r;
  }

  request(body: BridgeRequest, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BridgeResponse> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      const env: Envelope<BridgeRequest> = { token: this.token, id, body };
      this.win.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify(env) }));
    });
  }
}
