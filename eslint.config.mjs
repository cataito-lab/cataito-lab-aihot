import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = join(fileURLToPath(import.meta.url), "..");

/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  {
    extends: [
      join(__dirname, "node_modules", "eslint-config-next", "core-web-vitals.js"),
      join(__dirname, "node_modules", "eslint-config-next", "typescript.js"),
    ],
  },
];