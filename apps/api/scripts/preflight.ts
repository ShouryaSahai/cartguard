import "../src/env.js";

// Pre-recording preflight: verifies every rail CartGuard needs before you
// hit record on the demo video (PRD risk table: "health check before recording").
// Run: npm run preflight -w @cartguard/api

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function maskError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer [A-Za-z0-9._-]+/g, "Bearer ***")
    .replace(/AQ\.[A-Za-z0-9._-]+/g, "***")
    .slice(0, 140);
}

// 1. Environment variables
const required = [
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_API_BASE",
  "CHANNEL3_API_KEY",
  "GEMINI_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
];
const missing = required.filter((name) => (process.env[name] ?? "") === "");
record(
  "env vars",
  missing.length === 0,
  missing.length === 0 ? `all ${required.length} present` : `missing: ${missing.join(", ")}`,
);

// 2. PayPal sandbox OAuth
if ((process.env.PAYPAL_CLIENT_ID ?? "") !== "" && (process.env.PAYPAL_CLIENT_SECRET ?? "") !== "") {
  try {
    const response = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    record(
      "paypal rail",
      response.ok,
      response.ok ? "sandbox OAuth OK" : `HTTP ${response.status} — check ID/secret pair (must come from the same sandbox app)`,
    );
  } catch (error: unknown) {
    record("paypal rail", false, maskError(error));
  }
} else {
  record("paypal rail", false, "credentials missing");
}

// 3. Channel3
try {
  const response = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": process.env.CHANNEL3_API_KEY ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ query: "usb-c cable", limit: 1 }),
  });
  const body = (await response.json()) as { products?: unknown[] };
  record(
    "channel3",
    response.ok && (body.products?.length ?? 0) > 0,
    response.ok ? `search OK (${body.products?.length ?? 0} product)` : `HTTP ${response.status}`,
  );
} catch (error: unknown) {
  record("channel3", false, maskError(error));
}

// 4. Gemini
try {
  const response = await fetch(`${process.env.LLM_BASE_URL ?? ""}chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GEMINI_API_KEY ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL ?? "gemini-3.5-flash-lite",
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 200,
    }),
  });
  record("gemini llm", response.ok, response.ok ? "chat OK" : `HTTP ${response.status}`);
} catch (error: unknown) {
  record("gemini llm", false, maskError(error));
}

// 5. Database write
try {
  const { openDb } = await import("../src/db.js");
  const db = openDb(":memory:");
  db.createRequest("preflight-probe", "probe", 1);
  const row = db.getRequest("preflight-probe");
  db.close();
  record("sqlite", row !== null, "open + insert + read OK");
} catch (error: unknown) {
  record("sqlite", false, maskError(error));
}

console.log("\nCARTGUARD PREFLIGHT");
console.log("=".repeat(60));
let allOk = true;
for (const check of checks) {
  allOk = allOk && check.ok;
  console.log(`${check.ok ? "✅" : "❌"} ${check.name.padEnd(12)} ${check.detail}`);
}
console.log("=".repeat(60));
console.log(allOk ? "ALL SYSTEMS GO — safe to record the demo." : "Fix the ❌ rows before recording.");
process.exit(allOk ? 0 : 1);
