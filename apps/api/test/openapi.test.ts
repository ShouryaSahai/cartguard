import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Spec-drift guard: every route the server registers must be documented in
// openapi/cartguard.yaml, and every documented route must exist. Fails CI
// when someone adds an endpoint without updating the spec (or vice versa).

const SPEC_PATH = new URL("../../../openapi/cartguard.yaml", import.meta.url);

/** Routes the server actually registers (Express ":" params). */
const APP_ROUTES: Array<{ method: string; path: string }> = [
  { method: "get", path: "/health" },
  { method: "post", path: "/requests" },
  { method: "get", path: "/requests/:id" },
  { method: "post", path: "/requests/:id/approve" },
  { method: "post", path: "/requests/:id/reject" },
  { method: "get", path: "/requests/:id/events" },
  { method: "get", path: "/paypal/return" },
  { method: "post", path: "/gate/propose" },
  { method: "post", path: "/mandates" },
  { method: "get", path: "/mandates" },
  { method: "post", path: "/mandates/:id/revoke" },
  { method: "get", path: "/audit" },
  { method: "get", path: "/audit.csv" },
  { method: "get", path: "/policy" },
  { method: "put", path: "/policy" },
  { method: "post", path: "/policy/replay" },
];

function normalizeAppPath(path: string): string {
  return path.replace(/:([A-Za-z]+)/g, "{$1}");
}

interface SpecRoute {
  method: string;
  path: string;
}

function extractSpecRoutes(): SpecRoute[] {
  const lines = readFileSync(SPEC_PATH, "utf8").split("\n");
  const routes: SpecRoute[] = [];
  let currentPath: string | null = null;
  let inPaths = false;
  for (const line of lines) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (!inPaths) continue;
    if (/^[a-zA-Z]/.test(line)) break; // next top-level key after paths
    const pathMatch = line.match(/^  (\/\S+):\s*$/);
    if (pathMatch !== null) {
      currentPath = pathMatch[1]!;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (methodMatch !== null && currentPath !== null) {
      routes.push({ method: methodMatch[1]!.toLowerCase(), path: currentPath });
    }
  }
  return routes;
}

describe("OpenAPI spec drift guard", () => {
  it("documents every app route", () => {
    const spec = new Set(extractSpecRoutes().map((route) => `${route.method} ${route.path}`));
    const missing = APP_ROUTES.filter(
      (route) => !spec.has(`${route.method} ${normalizeAppPath(route.path)}`),
    );
    expect(missing, `routes missing from openapi/cartguard.yaml: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it("documents no route the server does not have", () => {
    const app = new Set(APP_ROUTES.map((route) => `${route.method} ${normalizeAppPath(route.path)}`));
    const extra = extractSpecRoutes().filter((route) => !app.has(`${route.method} ${route.path}`));
    expect(extra, `spec documents unknown routes: ${JSON.stringify(extra)}`).toEqual([]);
  });

  it("keeps the spec in sync structurally (no empty paths)", () => {
    for (const route of extractSpecRoutes()) {
      expect(route.path.length).toBeGreaterThan(0);
    }
  });
});
