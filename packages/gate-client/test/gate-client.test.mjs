import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CartGateClient } from "../index.mjs";

const VALID = {
  requestId: "r-1",
  status: "captured",
  verdict: "auto_pay",
  reasons: [],
  priceUsed: 30,
  approvalLink: null,
  paypalOrderId: "ORD-1",
  productId: "h1",
};

let servers = [];
let requests = [];

function startStub(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        requests.push({
          url: req.url,
          headers: req.headers,
          body: body === "" ? null : JSON.parse(body),
        });
        handler(req, res);
      });
    });
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
  requests = [];
});

describe("CartGateClient", () => {
  it("requires an API key", () => {
    expect(() => new CartGateClient({ gateUrl: "http://x" })).toThrow(/apiKey/);
  });

  it("sends the proposal with the x-api-key header and returns the verdict", async () => {
    const { port } = await startStub((req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(VALID));
    });
    const client = new CartGateClient({ gateUrl: `http://127.0.0.1:${port}`, apiKey: "k" });
    const verdict = await client.propose({
      goal: "earbuds under $60",
      budget: 60,
      proposal: { product_id: "h1", stated_price: 1, rationale: "fits", goal_match_score: 0.9 },
      search_median_price: 25,
    });
    expect(verdict.verdict).toBe("auto_pay");
    expect(verdict.priceUsed).toBe(30);
    expect(requests[0].headers["x-api-key"]).toBe("k");
    expect(requests[0].body.proposal.product_id).toBe("h1");
    expect(requests[0].body.search_median_price).toBe(25);
  });

  it("surfaces gate rejections as errors", async () => {
    const { port } = await startStub((req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    const client = new CartGateClient({ gateUrl: `http://127.0.0.1:${port}`, apiKey: "bad" });
    await expect(
      client.propose({ goal: "g", budget: 1, proposal: { product_id: "x", rationale: "r", goal_match_score: 0.5 } }),
    ).rejects.toThrow(/HTTP 401/);
  });
});
