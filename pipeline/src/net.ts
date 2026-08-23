import { ProxyAgent, fetch as undiciFetch, Agent, Dispatcher } from "undici";

let dispatcher: Dispatcher | undefined; // global dispatcher, used by default
let proxyBroken = false;
let failures = 0;

const DEAD_THRESHOLD = 2;

function proxyUrl(): string | undefined {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  );
}

function directAgent(): Dispatcher {
  return new Agent();
}

function setupDispatcher(direct: boolean): void {
  dispatcher = direct ? directAgent() : new ProxyAgent(proxyUrl()!);
}

function initDispatcher(): void {
  if (dispatcher) return;
  const p = proxyUrl();
  setupDispatcher(!p); // no proxy string -> direct; proxy present -> proxy dispatcher
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
    dispatcher = directAgent(); // all subsequent requests go direct immediately
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

  const fetchWith = (dp: Dispatcher) => undiciFetch(url, {
    dispatcher: dp,
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  }) as unknown as HttpResponse;

  const wrap = (res: unknown): HttpResponse => {
    const r = res as HttpResponse;
    if (typeof r.text !== "function") {
      (r as any).text = () => Promise.resolve(typeof res === "string" ? res : "");
    }
    if (typeof r.json !== "function") {
      (r as any).json = async () => JSON.parse(await (r as HttpResponse).text());
    }
    return r;
  };

  try {
    return wrap(await fetchWith(dispatcher as Dispatcher));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the proxy is dead, retry once directly (per-request direct agent).
    if (recordFailure(msg)) {
      try {
        return wrap(await fetchWith(directAgent()));
      } catch (directErr) {
        throw directErr instanceof Error ? directErr : new Error(String(directErr));
      }
    }
    throw err;
  }
}
