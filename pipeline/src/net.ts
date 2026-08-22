import { ProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";

let configured = false;

function ensureDispatcher(): void {
  if (configured) return;
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (proxy) {
    setGlobalDispatcher(new ProxyAgent(proxy));
  }
  configured = true;
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
  ensureDispatcher();
  return undiciFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  }) as unknown as HttpResponse;
}
