import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import express, { type Express } from "express";
import { z } from "zod";
import { PolicyConfigSchema } from "@cartguard/shared";
import { runAgent } from "./agent.js";
import { createChannel3Client, type Channel3Client } from "./channel3.js";
import { openDb, type CartGuardDb, type RequestStatus } from "./db.js";
import "./env.js";
import { createLlmCompleter, type ChatCompleter } from "./llm.js";
import { createPaypalOrdersFromEnv, type PaypalOrders } from "./paypal.js";
import { rememberVaultToken, startRequestProcessing } from "./requests.js";

export interface ServerDeps {
  db: CartGuardDb;
  llm: ChatCompleter;
  channel3: Channel3Client;
  paypal: PaypalOrders | null;
  publicBaseUrl: string;
  brandName: string;
}

const CreateRequestSchema = z.object({
  goal: z.string().min(3).max(500),
  budget: z.number().positive().max(1_000_000),
});

const TERMINAL_STATUSES: RequestStatus[] = [
  "captured",
  "needs_approval",
  "rejected",
  "blocked",
  "failed",
];

function hashRequestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Per-request approval secret: only the hash is stored; the plaintext is
 * returned exactly once by POST /requests and required by approve/reject. */
function authorizeRequestMutation(
  db: CartGuardDb,
  requestId: string,
  providedToken: string | undefined,
): boolean {
  const stored = db.getRequestApprovalSecretHash(requestId);
  if (stored === null || providedToken === undefined || providedToken === "") return false;
  return hashRequestToken(providedToken) === stored;
}

/** Per-IP sliding-window limiter for POST /requests. In-memory by design:
 * a restart clears it, which is acceptable for a demo-scale guard. */
const rateHits = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const limit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 10);
  const now = Date.now();
  const hits = (rateHits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= limit) {
    rateHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateHits.set(ip, hits);
  if (rateHits.size > 5000) {
    for (const [key, times] of rateHits) {
      if (times.every((t) => now - t >= 60_000)) rateHits.delete(key);
    }
  }
  return false;
}

export function createApp(deps: ServerDeps): Express {
  const app = express();
  // Behind Render's proxy (and in tests): honor X-Forwarded-For so per-IP
  // rate limiting sees real client IPs.
  app.set("trust proxy", true);
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      paypal: deps.paypal === null ? "unavailable" : "configured",
      time: new Date().toISOString(),
    });
  });

  app.post("/requests", (req, res) => {
    if (isRateLimited(req.ip ?? "unknown")) {
      res.status(429).json({ error: "rate_limited", hint: "too many requests from this address" });
      return;
    }
    const dailyCap = Number(process.env.DAILY_REQUEST_CAP ?? 200);
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);
    if (deps.db.requestsCreatedSince(startOfUtcDay.toISOString()) >= dailyCap) {
      res.status(429).json({ error: "daily_cap_reached", cap: dailyCap });
      return;
    }
    const parsed = CreateRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", detail: z.treeifyError(parsed.error) });
      return;
    }
    const id = randomUUID();
    const requestToken = randomBytes(24).toString("hex");
    deps.db.createRequest(id, parsed.data.goal, parsed.data.budget, hashRequestToken(requestToken));
    startRequestProcessing(id, parsed.data.goal, parsed.data.budget, deps);
    res.status(201).json({ id, requestToken });
  });

  app.get("/requests/:id", (req, res) => {
    const row = deps.db.getRequest(req.params.id ?? "");
    if (row === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    res.json({
      request: row,
      audit: deps.db.auditForRequest(row.id),
      approvalUrl: row.approvalUrl,
    });
  });

  app.post("/requests/:id/approve", async (req, res) => {
    const row = deps.db.getRequest(req.params.id ?? "");
    if (row === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRequestMutation(deps.db, row.id, req.header("x-request-token"))) {
      res.status(401).json({ error: "unauthorized", hint: "missing or invalid x-request-token" });
      return;
    }
    if (row.status !== "needs_approval" || deps.paypal === null || row.paypalOrderId === null) {
      res.status(409).json({ error: "not_approvable", status: row.status });
      return;
    }
    try {
      const capture = await deps.paypal.captureOrder(row.paypalOrderId);
      const status: RequestStatus = capture.status === "COMPLETED" ? "captured" : "failed";
      if (capture.status === "COMPLETED") {
        await rememberVaultToken(deps, row.paypalOrderId);
      }
      deps.db.finishRequest(row.id, status, row.chosenProduct, row.paypalOrderId, null);
      deps.db.appendAudit({
        requestId: row.id,
        step: "payment",
        productId: row.chosenProduct?.id ?? null,
        merchant: row.chosenProduct?.bestOffer?.domain ?? null,
        priceUsd: row.chosenProduct?.bestOffer?.price ?? null,
        verdict: "approved",
        reasons: [],
        llmRationale: "Human approved the proposed purchase.",
        paypalOrderId: row.paypalOrderId,
        paypalStatus: capture.status,
      });
      res.json({ id: row.id, status });
    } catch (error: unknown) {
      res.status(502).json({ error: "capture_failed", detail: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/requests/:id/reject", (req, res) => {
    const row = deps.db.getRequest(req.params.id ?? "");
    if (row === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!authorizeRequestMutation(deps.db, row.id, req.header("x-request-token"))) {
      res.status(401).json({ error: "unauthorized", hint: "missing or invalid x-request-token" });
      return;
    }
    if (row.status !== "needs_approval") {
      res.status(409).json({ error: "not_rejectable", status: row.status });
      return;
    }
    deps.db.setRequestStatus(row.id, "rejected");
    deps.db.appendAudit({
      requestId: row.id,
      step: "payment",
      productId: row.chosenProduct?.id ?? null,
      merchant: row.chosenProduct?.bestOffer?.domain ?? null,
      priceUsd: row.chosenProduct?.bestOffer?.price ?? null,
      verdict: "rejected",
      reasons: [],
      llmRationale: "Human rejected the proposed purchase.",
      paypalOrderId: row.paypalOrderId,
      paypalStatus: "VOIDED",
    });
    res.json({ id: row.id, status: "rejected" });
  });

  app.get("/paypal/return", async (req, res) => {
    const requestId = typeof req.query.request_id === "string" ? req.query.request_id : null;
    if (requestId === null) {
      res.status(404).send("Unknown request");
      return;
    }
    const row = deps.db.getRequest(requestId);
    if (row === null) {
      res.status(404).send("Unknown request");
      return;
    }
    // Only a pending human approval may be captured from this callback.
    if (row.status !== "needs_approval") {
      res.status(409).send(`Request is ${row.status}; nothing to capture`);
      return;
    }
    if (deps.paypal === null) {
      res.status(409).send("Payment rail unavailable");
      return;
    }
    // The token query param is informational only: authorization and capture
    // always use the order id stored with the request, never the query string.
    const orderId = row.paypalOrderId;
    if (orderId === null) {
      res.status(409).send("No PayPal order was prepared for this request");
      return;
    }
    try {
      const capture = await deps.paypal.captureOrder(orderId);
      const status: RequestStatus = capture.status === "COMPLETED" ? "captured" : "failed";
      if (capture.status === "COMPLETED") {
        await rememberVaultToken(deps, orderId);
      }
      deps.db.finishRequest(row.id, status, row.chosenProduct, orderId, null);
      deps.db.appendAudit({
        requestId: row.id,
        step: "payment",
        productId: row.chosenProduct?.id ?? null,
        merchant: row.chosenProduct?.bestOffer?.domain ?? null,
        priceUsd: row.chosenProduct?.bestOffer?.price ?? null,
        verdict: "buyer_returned",
        reasons: [],
        llmRationale: "Buyer approved in PayPal sandbox and returned.",
        paypalOrderId: orderId,
        paypalStatus: capture.status,
      });
      res.send(`<!doctype html><html><body><script>location.replace("${deps.publicBaseUrl}/?request=${row.id}&status=${status}")</script></body></html>`);
    } catch (error: unknown) {
      res.status(502).send(`Capture failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  app.get("/audit", (req, res) => {
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 200;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 1000) : 200;
    res.json({ rows: deps.db.listAudit(limit) });
  });

  app.get("/policy", (_req, res) => {
    res.json(deps.db.getPolicy());
  });

  app.put("/policy", (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN ?? "";
    if (adminToken === "") {
      res.status(403).json({ error: "admin_token_not_configured", hint: "set ADMIN_TOKEN to allow policy writes" });
      return;
    }
    if (req.header("x-admin-token") !== adminToken) {
      res.status(401).json({ error: "unauthorized", hint: "missing or invalid x-admin-token" });
      return;
    }
    const parsed = PolicyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_policy", detail: z.treeifyError(parsed.error) });
      return;
    }
    deps.db.putPolicy(parsed.data);
    res.json(parsed.data);
  });

  // Serve the built web app when it exists, with an SPA fallback for
  // client-side routes. API paths always fall through to the 404 handler.
  const webDist = path.resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      const apiPrefixes = ["/requests", "/audit", "/policy", "/health", "/paypal"];
      if (req.method !== "GET" || apiPrefixes.some((prefix) => req.path.startsWith(prefix))) {
        next();
        return;
      }
      res.sendFile(join(webDist, "index.html"));
    });
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return app;
}

export function main(): void {
  const dbPath = process.env.DB_PATH ?? "data/cartguard.sqlite";
  mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = openDb(dbPath);
  let paypal: PaypalOrders | null = null;
  try {
    paypal = createPaypalOrdersFromEnv();
  } catch {
    paypal = null;
  }
  const app = createApp({
    db,
    llm: createLlmCompleter(),
    channel3: createChannel3Client(),
    paypal,
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
    brandName: "CartGuard",
  });
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    console.log(`CartGuard API listening on :${port} (paypal: ${paypal === null ? "unavailable" : "configured"})`);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
