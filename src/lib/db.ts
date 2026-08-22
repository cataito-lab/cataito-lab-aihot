import "server-only";
import type { Client } from "@libsql/client/web";

// Use the web (fetch-based) entry of @libsql/client so it runs on the Edge
// Runtime (Cloudflare Workers/Pages). Requires a remote libsql:// or https:// URL.
let client: Client | null = null;

async function createClient(): Promise<Client> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set (the edge-compatible client only supports remote URLs)",
    );
  }
  const { createClient: makeClient } = await import("@libsql/client/web");
  return makeClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  });
}

export async function getDb(): Promise<Client> {
  if (!client) {
    client = await createClient();
  }
  return client;
}