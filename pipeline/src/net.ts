import { ProxyAgent, Agent, setGlobalDispatcher, type Dispatcher } from "undici";

let proxyBroken = false;
let failures = 0;
let current: Dispatcher | null = null;

const DEAD_THRESHOLD = 2;

function proxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  );
}

function makeDispatcher(direct: boolean): Dispatcher {
  return direct ? new Agent() : new ProxyAgent(proxyUrl()!);
}

function ensure(direct: boolean): void {
  if (current) return;
  current = makeDispatcher(direct);
  setGlobalDispatcher(current);
}

function initDispatcher(): void {
  ensure(!proxyUrl()); // no proxy string -> direct; proxy present -> proxy dispatcher
}

/**
 * Called after a request threw. If it looks like a proxy transport failure
 * and we've seen enough, switch the global dispatcher to direct so *all*
 * subsequent requests go direct, and signal the caller to retry.
 */
export function recordFailure(msg: string): boolean {
  const transportFail =
    msg.includes("ECONNREFUSED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("connect E") ||
    msg.includes("ENETUNREACH") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("Could not connect") ||
    msg.includes("Proxy opts.uri") ||
    msg.includes("proxy") ||
    msg === "fetch failed";
  if (!transportFail) return false;

  if (proxyBroken) return true;
  failures++;
  if (failures >= DEAD_THRESHOLD) {
    const p = proxyUrl();
    console.warn(`[net] proxy ${p ?? "<none>"} appears dead (${failures} transport failures) -- switching to direct connect for the remainder of this run`);
    proxyBroken = true;
    current = new Agent();
    setGlobalDispatcher(current); // all subsequent requests go direct immediately
    return true;
  }
  return false;
}

export type HttpRequestInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export async function httpFetch(
  url: string,
  init: HttpRequestInit = {},
): Promise<HttpResponse> {
  initDispatcher();
  const doFetch = () =>
    fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
    }) as unknown as HttpResponse;
  try {
    return await doFetch();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the proxy is dead, retry once (global dispatcher already switched to direct).
    if (recordFailure(msg)) {
      try {
        return await doFetch();
      } catch (directErr) {
        throw directErr instanceof Error ? directErr : new Error(String(directErr));
      }
    }
    throw err;
  }
}
