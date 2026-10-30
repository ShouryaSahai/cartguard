import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

function fakePaypal(): PaypalOrders & { captures: string[] } {
  const captures: string[] = [];
  return {
    captures,
    createOrder: async (params) => {
      void params;
      return {
        orderId: `ORD-${Math.random()}`,
        status: "APPROVED",
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORD-X",
      };
    },
    captureOrder: async (orderId) => {
      captures.push(orderId);
      return { orderId, status: "COMPLETED" };
    },
  };
}

interface RunningServer {
  db: CartGuardDb;
  deps: ServerDeps;
  baseUrl: string;
  close: () => void;
}

const running: RunningServer[] = [];

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

async function createRequest(baseUrl: string, body: object): Promise<string> {
  const response = await fetch(`${baseUrl}/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  const data = (await response.json()) as { id: string };
  return data.id;
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
    const id = await createRequest(harness.baseUrl, { goal: "wireless earbuds under $60", budget: 60 });
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
    const id = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 10 });
    const { status } = await waitForStatus(harness.baseUrl, id);
    expect(status).toBe("blocked");
    const paypalFake = harness.deps.paypal as PaypalOrders & { captures: string[] };
    expect(paypalFake.captures.length).toBe(0);
  });

  it("needs_approval: human approve captures, reject voids", async () => {
    const harness = await startServer({ paypal: fakePaypal() });
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 20 });
    const id = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 100 });
    const { status, approvalUrl } = await waitForStatus(harness.baseUrl, id);
    expect(status).toBe("needs_approval");
    expect(approvalUrl).toContain("paypal.com");
    const approve = await fetch(`${harness.baseUrl}/requests/${id}/approve`, { method: "POST" });
    expect(approve.status).toBe(200);
    const approved = (await approve.json()) as { status: string };
    expect(approved.status).toBe("captured");
  });

  it("needs_approval: rejecting keeps money untouched", async () => {
    const harness = await startServer();
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, perPurchaseCap: 20 });
    const id = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 100 });
    await waitForStatus(harness.baseUrl, id);
    const reject = await fetch(`${harness.baseUrl}/requests/${id}/reject`, { method: "POST" });
    const data = (await reject.json()) as { status: string };
    expect(data.status).toBe("rejected");
    const paypalFake = harness.deps.paypal as PaypalOrders & { captures: string[] };
    expect(paypalFake.captures.length).toBe(0);
  });
});

describe("server: policy and audit surfaces", () => {
  it("weekly spend accumulates from captured rows and tightens the next verdict", async () => {
    const harness = await startServer();
    const config = harness.db.getPolicy();
    harness.db.putPolicy({ ...config, weeklyCap: 40, perPurchaseCap: 100 });
    const first = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    expect((await waitForStatus(harness.baseUrl, first)).status).toBe("captured");
    const second = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    const { status } = await waitForStatus(harness.baseUrl, second);
    expect(status).toBe("needs_approval");
  });

  it("GET /policy returns the stored policy and PUT /policy validates strictly", async () => {
    const harness = await startServer();
    const initial = await (await fetch(`${harness.baseUrl}/policy`)).json();
    expect(initial).toMatchObject({ perPurchaseCap: 100, weeklyCap: 500 });
    const bad = await fetch(`${harness.baseUrl}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perPurchaseCap: -5 }),
    });
    expect(bad.status).toBe(400);
    const put = await fetch(`${harness.baseUrl}/policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ perPurchaseCap: 42, weeklyCap: 100 }),
    });
    expect(put.status).toBe(200);
    expect(await (await fetch(`${harness.baseUrl}/policy`)).json()).toMatchObject({ perPurchaseCap: 42 });
  });

  it("GET /audit exposes the decision log for the AG Grid", async () => {
    const harness = await startServer();
    const id = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    await waitForStatus(harness.baseUrl, id);
    const data = (await (await fetch(`${harness.baseUrl}/audit`)).json()) as {
      rows: Array<{ step: string; verdict: string }>;
    };
    expect(data.rows.length).toBeGreaterThanOrEqual(2);
    expect(data.rows.some((row) => row.step === "gate" && row.verdict === "auto_pay")).toBe(true);
  });

  it("degrades to needs_approval with an UNAVAILABLE payment row when PayPal is not configured", async () => {
    const harness = await startServer({ paypal: null });
    const id = await createRequest(harness.baseUrl, { goal: "earbuds", budget: 60 });
    const { status } = await waitForStatus(harness.baseUrl, id);
    expect(status).toBe("needs_approval");
    const detail = (await (await fetch(`${harness.baseUrl}/requests/${id}`)).json()) as {
      audit: Array<{ step: string; paypalStatus: string | null }>;
    };
    expect(detail.audit.some((row) => row.step === "payment" && row.paypalStatus === "UNAVAILABLE")).toBe(true);
  });
});
