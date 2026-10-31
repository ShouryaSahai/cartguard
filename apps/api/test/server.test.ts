import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Channel3Client } from "../src/channel3.js";
import type { ChatCompleter, LlmReply, LlmMessage, LlmTool } from "../src/llm.js";
import type { PaypalOrders } from "../src/paypal.js";
import { createApp, type ServerDeps } from "../src/server.js";
import { openDb, type CartGuardDb } from "../src/db.js";
import type { NormalizedProduct } from "@cartguard/shared";

function product(id: string, price: number): NormalizedProduct {
  const offer = {
    url: "https://adorama.com/p",
    domain: "adorama.com",
    price,
    compareAtPrice: null,
    currency: "USD",
    availability: "InStock",
    inStock: true,
  };
  return {
    id,
    title: "Acme Earbuds",
    description: "",
    brand: "Acme",
    categorySlug: "headphones",
    image: null,
    rating: 4.5,
    offers: [offer],
    bestOffer: offer,
  };
}

const PRODUCT = product("p1", 30);

function fakeLlm(): ChatCompleter {
  return async (_request: { messages: LlmMessage[]; tools: LlmTool[] }): Promise<LlmReply> => ({
    content: null,
    toolCalls: [
      {
        id: `c${Math.random()}`,
        name: "propose_purchase",
        arguments: JSON.stringify({
          product_id: "p1",
          stated_price: 1,
          rationale: "cheapest in-stock earbuds",
          goal_match_score: 0.95,
        }),
      },
    ],
  });
}

function fakeChannel3(): Channel3Client {
  return {
    searchProducts: async () => ({ products: [PRODUCT], nextPageToken: null }),
    getProduct: async () => PRODUCT,
  };
}

interface FakePaypalState {
  creates: Array<{ amountUsd: number; vaultId?: string }>;
  captures: string[];
}

function fakePaypal(
  options: { createStatus?: string } = {},
): PaypalOrders & FakePaypalState {
  const state: FakePaypalState = { creates: [], captures: [] };
  return {
    creates: state.creates,
    captures: state.captures,
    createOrder: async (params) => {
      state.creates.push({ amountUsd: params.amountUsd, vaultId: params.vaultId });
      return {
        orderId: `ORD-${state.creates.length}`,
        status: options.createStatus ?? "APPROVED",
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD-X",
      };
    },
    captureOrder: async (orderId) => {
      state.captures.push(orderId);
      return { orderId, status: "COMPLETED" };
    },
    getVaultId: async () =>
      state.captures.length > 0 || options.createStatus === "COMPLETED"
        ? "VAULT-TOKEN-001"
        : null,
  };
}

interface RunningServer {
  db: CartGuardDb;
  deps: ServerDeps;
  baseUrl: string;
  close: () => void;
}

const running: RunningServer[] = [];

// The suite creates many requests from one address; keep the abuse-limit
// guard out of the way except inside its own dedicated tests.
beforeAll(() => {
  process.env.RATE_LIMIT_PER_MINUTE = "100000";
});
afterAll(() => {
  delete process.env.RATE_LIMIT_PER_MINUTE;
});

async function startServer(overrides: Partial<ServerDeps> = {}): Promise<RunningServer> {
  const db = openDb(":memory:");
  const deps: ServerDeps = {
    db,
    llm: fakeLlm(),
    channel3: fakeChannel3(),
    paypal: fakePaypal(),
    publicBaseUrl: "http://localhost:3000",
    brandName: "CartGuard",
    ...overrides,
  };
  const app = createApp(deps);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const handle: RunningServer = {
    db,
    deps,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => {
      server.close();
      db.close();
    },
  };
  running.push(handle);
  return handle;
}

afterEach(() => {
  while (running.length > 0) {
    running.pop()?.close();
  }
});

async function createRequest(baseUrl: string, body: object): Promise<{ id: string; token: string }> {
  const response = await fetch(`${baseUrl}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  const data = (await response.json()) as { id: string; requestToken: string };
  return { id: data.id, token: data.requestToken };
}

async function waitForStatus(baseUrl: string, id: string): Promise<{ status: string; approvalUrl: string | null }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${baseUrl}/requests/${id}`);
    if (response.status === 200) {
      const data = (await response.json()) as { request: { status: string }; approvalUrl: string | null };
      if (["captured", "needs_approval", "rejected", "blocked", "failed"].includes(data.request.status)) {
        return { status: data.request.status, approvalUrl: data.approvalUrl };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("request did not reach a terminal status in time");
}

describe("server: health and validation", () => {
  it("reports health with the paypal rail state", async () => {
    const harness = await startServer();
    const response = await fetch(`${harness.baseUrl}/health`);
    const data = (await response.json()) as { ok: boolean; paypal: string };
    expect(response.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.paypal).toBe("configured");
  });

  it("rejects an invalid request body with 400", async () => {
    const harness = await startServer();
    const response = await fetch(`${harness.baseUrl}/requests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "earbuds" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("server: the three demo paths", () => {
  it("auto_pay: agent proposes, gate verifies price 30 (not the LLM's 1), PayPal captures", async () => {
    const harness = await startServer();
    const { id } = await createRequest(harness.baseUrl, { goal: "wireless earbuds under $60", budget: 60 });
    const { status } = await waitForStatus(harness.baseUrl, id);
    expect(status).toBe("captured");
    const detail = (await (await fetch(`${harness.baseUrl}/requests/${id}`)).json()) as {
      request: { chosenProduct: NormalizedProduct | null };
      audit: Array<{ step: string; priceUsd: number | null; verdict: string }>;
    };
    const gateRow = detail.audit.find((row) => row.step === "gate");
    expect(gateRow?.priceUsd).toBe(30);
    const paypalFake = harness.deps.paypal as PaypalOrders & { captures: string[] };
    expect(paypalFake.captures.length).toBe(1);
    expect(detail.request.chosenProduct!.id).toBe("p1");
  });

  it("blocked: over-budget proposals never reach PayPal", async () => {
    const harness = await startServer();
    const { id } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 10 });
    const { status } = await waitForStatus(harness.baseUrl, id);
    expect(status).toBe("blocked");
    const paypalFake = harness.deps.paypal as PaypalOrders & { captures: string[] };
    expect(paypalFake.captures.length).toBe(0);
  });

  it("needs_approval: human approve captures, reject voids", async () => {
    const harness = await startServer({ paypal: fakePaypal() });
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 20 });
    const { id, token } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 100 });
    const { status, approvalUrl } = await waitForStatus(harness.baseUrl, id);
    expect(status).toBe("needs_approval");
    expect(approvalUrl).toContain("paypal.com");
    const approve = await fetch(`${harness.baseUrl}/requests/${id}/approve`, { method: "POST", headers: { "x-request-token": token } });
    expect(approve.status).toBe(200);
    const approved = (await approve.json()) as { status: string };
    expect(approved.status).toBe("captured");
  });

  it("needs_approval: rejecting keeps money untouched", async () => {
    const harness = await startServer();
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 20 });
    const { id, token } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 100 });
    await waitForStatus(harness.baseUrl, id);
    const reject = await fetch(`${harness.baseUrl}/requests/${id}/reject`, { method: "POST", headers: { "x-request-token": token } });
    const data = (await reject.json()) as { status: string };
    expect(data.status).toBe("rejected");
    const paypalFake = harness.deps.paypal as PaypalOrders & { captures: string[] };
    expect(paypalFake.captures.length).toBe(0);
  });

  it("vault: COMPLETED-on-create is recorded as captured without any capture call", async () => {
    const harness = await startServer({ paypal: fakePaypal({ createStatus: "COMPLETED" }) });
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 100 });
    const { id } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    expect((await waitForStatus(harness.baseUrl, id)).status).toBe("captured");
    const paypalFake = harness.deps.paypal as PaypalOrders & FakePaypalState;
    expect(paypalFake.creates.length).toBe(1);
    expect(paypalFake.captures.length).toBe(0);
    const detail = (await (await fetch(`${harness.baseUrl}/requests/${id}`)).json()) as {
      audit: Array<{ step: string; paypalStatus: string | null }>;
    };
    expect(detail.audit.some((row) => row.step === "payment" && row.paypalStatus === "CAPTURED")).toBe(true);
  });

  it("vault: after one approval, later auto_pay purchases charge the saved token", async () => {
    const harness = await startServer();
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, weeklyCap: 5000, perPurchaseCap: 100 });
    const first = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    expect((await waitForStatus(harness.baseUrl, first.id)).status).toBe("captured");
    const second = await createRequest(harness.baseUrl, { goal: "earbuds again", budget: 60 });
    expect((await waitForStatus(harness.baseUrl, second.id)).status).toBe("captured");
    const paypalFake = harness.deps.paypal as PaypalOrders & FakePaypalState;
    expect(paypalFake.creates.length).toBe(2);
    expect(paypalFake.creates[0]!.vaultId).toBeUndefined();
    expect(paypalFake.creates[1]!.vaultId).toBe("VAULT-TOKEN-001");
    const detail = (await (await fetch(`${harness.baseUrl}/requests/${second.id}`)).json()) as {
      audit: Array<{ step: string; llmRationale: string | null }>;
    };
    const paymentRow = detail.audit.find((row) => row.step === "payment" && row.llmRationale !== null);
    expect(paymentRow?.llmRationale).toContain("saved PayPal payment token");
  });
});

describe("server: policy and audit surfaces", () => {
  it("weekly spend accumulates from captured rows and tightens the next verdict", async () => {
    const harness = await startServer();
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, weeklyCap: 40, perPurchaseCap: 100 });
    const first = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    expect((await waitForStatus(harness.baseUrl, first.id)).status).toBe("captured");
    const second = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    const { status } = await waitForStatus(harness.baseUrl, second.id);
    expect(status).toBe("needs_approval");
  });

  it("GET /policy returns the stored policy and PUT /policy validates strictly", async () => {
    const harness = await startServer();
    const initial = await (await fetch(`${harness.baseUrl}/policy`)).json();
    expect(initial).toMatchObject({ perPurchaseCap: 100, weeklyCap: 500 });
    const previous = process.env.ADMIN_TOKEN;
    process.env.ADMIN_TOKEN = "test-admin-token";
    try {
      const bad = await fetch(`${harness.baseUrl}/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": "test-admin-token" },
        body: JSON.stringify({ perPurchaseCap: -5 }),
      });
      expect(bad.status).toBe(400);
      const put = await fetch(`${harness.baseUrl}/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-admin-token": "test-admin-token" },
        body: JSON.stringify({ perPurchaseCap: 42, weeklyCap: 100 }),
      });
      expect(put.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_TOKEN;
      else process.env.ADMIN_TOKEN = previous;
    }
    expect(await (await fetch(`${harness.baseUrl}/policy`)).json()).toMatchObject({ perPurchaseCap: 42 });
  });

  it("GET /audit exposes the decision log for the AG Grid", async () => {
    const harness = await startServer();
    const { id } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    await waitForStatus(harness.baseUrl, id);
    const data = (await (await fetch(`${harness.baseUrl}/audit`)).json()) as {
      rows: Array<{ step: string; verdict: string }>;
    };
    expect(data.rows.length).toBeGreaterThanOrEqual(2);
    expect(data.rows.some((row) => row.step === "gate" && row.verdict === "auto_pay")).toBe(true);
  });

  it("degrades to needs_approval with an UNAVAILABLE payment row when PayPal is not configured", async () => {
    const harness = await startServer({ paypal: null });
    const { id } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    const { status } = await waitForStatus(harness.baseUrl, id);
    expect(status).toBe("needs_approval");
    const detail = (await (await fetch(`${harness.baseUrl}/requests/${id}`)).json()) as {
      audit: Array<{ step: string; paypalStatus: string | null }>;
    };
    expect(detail.audit.some((row) => row.step === "payment" && row.paypalStatus === "UNAVAILABLE")).toBe(true);
  });
});

describe("server: mutating-endpoint auth", () => {
  const ORIGINAL_ADMIN = process.env.ADMIN_TOKEN;

  afterEach(() => {
    if (ORIGINAL_ADMIN === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = ORIGINAL_ADMIN;
  });

  it("PUT /policy returns 403 when ADMIN_TOKEN is not configured", async () => {
    delete process.env.ADMIN_TOKEN;
    const harness = await startServer();
    const response = await fetch(`${harness.baseUrl}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": "anything" },
      body: JSON.stringify({ perPurchaseCap: 42, weeklyCap: 100 }),
    });
    expect(response.status).toBe(403);
  });

  it("PUT /policy returns 401 without or with a wrong token, 200 with the right one", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    const harness = await startServer();
    const body = JSON.stringify({ perPurchaseCap: 42, weeklyCap: 100 });
    const noToken = await fetch(`${harness.baseUrl}/policy`, { method: "PUT", headers: { "Content-Type": "application/json" }, body });
    expect(noToken.status).toBe(401);
    const wrongToken = await fetch(`${harness.baseUrl}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": "wrong" },
      body,
    });
    expect(wrongToken.status).toBe(401);
    const rightToken = await fetch(`${harness.baseUrl}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-admin-token": "test-admin-token" },
      body,
    });
    expect(rightToken.status).toBe(200);
  });

  it("approve/reject require the per-request secret: 401 without, 401 wrong, 200 right", async () => {
    const harness = await startServer();
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 20 });
    const { id, token } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 100 });
    await waitForStatus(harness.baseUrl, id);
    const noToken = await fetch(`${harness.baseUrl}/requests/${id}/approve`, { method: "POST" });
    expect(noToken.status).toBe(401);
    const wrongToken = await fetch(`${harness.baseUrl}/requests/${id}/approve`, {
      method: "POST",
      headers: { "x-request-token": "guess" },
    });
    expect(wrongToken.status).toBe(401);
    const rightToken = await fetch(`${harness.baseUrl}/requests/${id}/approve`, {
      method: "POST",
      headers: { "x-request-token": token },
    });
    expect(rightToken.status).toBe(200);
    // Auth runs before state checks: without a token the endpoint must not
    // even reveal whether the request exists or is capturable.
    const rejectNoToken = await fetch(`${harness.baseUrl}/requests/${id}/reject`, { method: "POST" });
    expect(rejectNoToken.status).toBe(401);
  });

  it("GET /requests/:id and GET /audit never expose the request token", async () => {
    const harness = await startServer();
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 20 });
    const { id, token } = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 100 });
    await waitForStatus(harness.baseUrl, id);
    const detailBody = await (await fetch(`${harness.baseUrl}/requests/${id}`)).text();
    expect(detailBody).not.toContain(token);
    expect(detailBody).not.toMatch(/requestToken|approval_secret/i);
    const auditBody = await (await fetch(`${harness.baseUrl}/audit`)).text();
    expect(auditBody).not.toContain(token);
  });
});

describe("server: spending mandates", () => {
  it("create -> gated purchase references the mandate -> revoke blocks the next one", async () => {
    process.env.ADMIN_TOKEN = "test-admin-token";
    try {
      const harness = await startServer();
      const headers = { "Content-Type": "application/json", "x-admin-token": "test-admin-token" };
      const created = await fetch(`${harness.baseUrl}/mandates`, {
        method: "POST",
        headers,
        body: JSON.stringify({ budgetUsd: 100, maxItems: 2 }),
      });
      expect(created.status).toBe(201);
      const mandate = (await created.json()) as { id: string };

      const first = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60, mandate_id: mandate.id });
      expect((await waitForStatus(harness.baseUrl, first.id)).status).toBe("captured");

      // Mandate budget 100: 21.99 captured once; second still fits.
      const second = await createRequest(harness.baseUrl, { goal: "earbuds again", budget: 60, mandate_id: mandate.id });
      expect((await waitForStatus(harness.baseUrl, second.id)).status).toBe("captured");

      await fetch(`${harness.baseUrl}/mandates/${mandate.id}/revoke`, { method: "POST", headers });
      const third = await createRequest(harness.baseUrl, { goal: "earbuds after revoke", budget: 60, mandate_id: mandate.id });
      const detail = (await (await fetch(`${harness.baseUrl}/requests/${third.id}`)).json()) as {
        request: { status: string };
        audit: Array<{ mandateId: string | null; reasons: Array<{ rule: string }> }>;
      };
      expect(detail.request.status).toBe("blocked");
      expect(detail.audit.some((row) => row.mandateId === mandate.id)).toBe(true);
      expect(detail.audit.some((row) => row.reasons.some((reason) => reason.rule === "mandate_revoked"))).toBe(true);

      const unknown = await fetch(`${harness.baseUrl}/requests`, {
        method: "POST",
        headers,
        body: JSON.stringify({ goal: "earbuds", budget: 60, mandate_id: "00000000-0000-4000-8000-000000000000" }),
      });
      expect(unknown.status).toBe(400);
    } finally {
      delete process.env.ADMIN_TOKEN;
    }
  });
});

describe("server: /paypal/return hardening", () => {
  async function makePending(baseUrl: string): Promise<{ id: string; token: string; orderId: string }> {
    const harness = running[running.length - 1]!;
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 20 });
    const { id, token } = await createRequest(baseUrl, { goal: "earbuds", budget: 100 });
    const detail = (await waitForStatus(baseUrl, id)) as { status: string; approvalUrl: string };
    expect(detail.status).toBe("needs_approval");
    const row = harness.db.getRequest(id);
    expect(row?.paypalOrderId).not.toBeNull();
    return { id, token, orderId: row!.paypalOrderId! };
  }

  it("captures the STORED order id and ignores the token query param", async () => {
    await startServer();
    const { baseUrl } = running[running.length - 1]!;
    const { id, orderId } = await makePending(baseUrl);
    const response = await fetch(`${baseUrl}/paypal/return?request_id=${id}&token=SOMETHING-ELSE`);
    expect(response.status).toBe(200);
    const paypalFake = harness_paypal();
    expect(paypalFake.captures).toContain(orderId);
    expect(paypalFake.captures).not.toContain("SOMETHING-ELSE");
    const detail = (await (await fetch(`${baseUrl}/requests/${id}`)).json()) as { request: { status: string } };
    expect(detail.request.status).toBe("captured");
  });

  it("refuses to capture a rejected request", async () => {
    await startServer();
    const { baseUrl } = running[running.length - 1]!;
    const { id, token } = await makePending(baseUrl);
    await fetch(`${baseUrl}/requests/${id}/reject`, { method: "POST", headers: { "x-request-token": token } });
    const response = await fetch(`${baseUrl}/paypal/return?request_id=${id}`);
    expect(response.status).toBe(409);
  });

  it("refuses to capture an already-captured request (replay)", async () => {
    await startServer();
    const { baseUrl } = running[running.length - 1]!;
    const { id, token } = await makePending(baseUrl);
    await fetch(`${baseUrl}/requests/${id}/approve`, { method: "POST", headers: { "x-request-token": token } });
    const replay = await fetch(`${baseUrl}/paypal/return?request_id=${id}`);
    expect(replay.status).toBe(409);
    const paypalFake = harness_paypal();
    expect(paypalFake.captures.length).toBe(1);
  });

  it("refuses to capture a blocked request and 404s unknown ids", async () => {
    await startServer();
    const { baseUrl } = running[running.length - 1]!;
    const { id } = await createRequest(baseUrl, { goal: "earbuds", budget: 10 });
    await waitForStatus(baseUrl, id); // blocked
    expect((await fetch(`${baseUrl}/paypal/return?request_id=${id}`)).status).toBe(409);
    expect((await fetch(`${baseUrl}/paypal/return?request_id=00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/paypal/return`)).status).toBe(404);
  });
});

function harness_paypal(): PaypalOrders & FakePaypalState {
  const harness = running[running.length - 1]!;
  return harness.deps.paypal as PaypalOrders & FakePaypalState;
}

describe("server: abuse limits", () => {
  const SAVED: Record<string, string | undefined> = {};

  beforeEach(() => {
    SAVED.RATE_LIMIT_PER_MINUTE = process.env.RATE_LIMIT_PER_MINUTE;
    SAVED.DAILY_REQUEST_CAP = process.env.DAILY_REQUEST_CAP;
    process.env.RATE_LIMIT_PER_MINUTE = "100000";
    delete process.env.DAILY_REQUEST_CAP;
  });

  afterEach(() => {
    if (SAVED.RATE_LIMIT_PER_MINUTE === undefined) delete process.env.RATE_LIMIT_PER_MINUTE;
    else process.env.RATE_LIMIT_PER_MINUTE = SAVED.RATE_LIMIT_PER_MINUTE;
    if (SAVED.DAILY_REQUEST_CAP === undefined) delete process.env.DAILY_REQUEST_CAP;
    else process.env.DAILY_REQUEST_CAP = SAVED.DAILY_REQUEST_CAP;
  });

  it("rate-limits POST /requests per IP with 429", async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "2";
    await startServer();
    const { baseUrl } = running[running.length - 1]!;
    const ip = "10.77.0.1";
    const post = () =>
      fetch(`${baseUrl}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ goal: "earbuds", budget: 60 }),
      });
    expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(201);
    const third = await post();
    expect(third.status).toBe(429);
    const detail = (await third.json()) as { error: string };
    expect(detail.error).toBe("rate_limited");
  });

  it("enforces the global daily request cap with 429", async () => {
    process.env.DAILY_REQUEST_CAP = "1";
    await startServer();
    const { baseUrl } = running[running.length - 1]!;
    const ip = "10.77.0.2";
    const post = () =>
      fetch(`${baseUrl}/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ goal: "earbuds", budget: 60 }),
      });
    expect((await post()).status).toBe(201);
    const second = await post();
    expect(second.status).toBe(429);
    const detail = (await second.json()) as { error: string; cap: number };
    expect(detail.error).toBe("daily_cap_reached");
    expect(detail.cap).toBe(1);
  });
});
