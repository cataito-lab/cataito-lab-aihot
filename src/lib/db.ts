import "server-only";
import type { Client } from "@libsql/client";

// Dynamic import so webpack doesn't try to bundle @libsql/client's C++ native deps.
// At runtime (CF Pages / Vercel), the native module resolves against the
// deployed Node runtime, which supports it.
let client: Client | null = null;

async function createClient(): Promise<Client> {
  const { createClient: makeClient } = await import("@libsql/client");
  return makeClient({
    url: process.env.TURSO_DATABASE_URL || "file:./data/local.db",
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
}

export async function getDb(): Promise<Client> {
  if (!client) {
    client = await createClient();
  }
  return client;
}