const KEY = "favorites";

let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  if (cache === null) {
    try {
      const raw = localStorage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      cache = Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      cache = [];
    }
  }
  return cache!;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function isFavorite(id: string): boolean {
  return read().includes(id);
}

export function toggleFavorite(id: string): boolean {
  const list = read();
  const had = list.includes(id);
  const next = had ? list.filter((x) => x !== id) : [...list, id];
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  emit();
  return !had;
}

export function subscribeFavorites(callback: () => void): () => void {
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

export function readFavorites(): string[] {
  return read();
}
