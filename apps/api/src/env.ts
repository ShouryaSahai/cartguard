import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load .env from the workspace root regardless of the process cwd,
// so npm workspace scripts (which run inside apps/api) see the secrets.
const srcDir = fileURLToPath(new URL(".", import.meta.url));
dotenv.config({ path: `${srcDir}../../../.env`, quiet: true });

export function requireEnv(name: string): string {
  const value = process.env[name] ?? "";
  if (value === "") throw new Error(`${name} is not set`);
  return value;
}
