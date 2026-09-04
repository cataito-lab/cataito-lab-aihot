const KEY = "insightExpanded";

// 全站共享的洞察展开偏好（跨卡片同步），默认折叠；SSR 快照恒为折叠，挂载后才读真实值。
let cache: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (cache === null) {
    try {
      cache = localStorage.getItem(KEY) === "1";
    } catch {
      cache = false;
    }
  }
  return cache;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function isInsightExpanded(): boolean {
  return read();
}

export function setInsightExpanded(v: boolean): void {
  cache = v;
  try {
    localStorage.setItem(KEY, v ? "1" : "0");
  } catch {}
  emit();
}

export function subscribeInsightPref(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      cache = null;
      callback();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}
