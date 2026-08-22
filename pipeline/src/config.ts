import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SourceDef } from "./types";

const SOURCES_FILE = fileURLToPath(new URL("../feeds/sources.json", import.meta.url));

export function loadSources(): SourceDef[] {
  return JSON.parse(readFileSync(SOURCES_FILE, "utf-8")) as SourceDef[];
}
