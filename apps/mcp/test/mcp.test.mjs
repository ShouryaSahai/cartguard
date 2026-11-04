import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

// Tests the REAL MCP stdio server end to end: spawn it, speak JSON-RPC 2.0
// over stdin/stdout, and verify the bridge to a stub gate API.

const MCP_ENTRY = fileURLToPath(new URL("../src/index.mjs", import.meta.url));
const VERDICT = {
  requestId: "r-1",
  status: "captured",
  verdict: "auto_pay",
  reasons: [],
  priceUsed: 21.99,
  approvalLink: null,
  paypalOrderId: "ORD-1",
  productId: "demo-earbuds-1",
};

let gateServer;
let gateRequests = [];
let children = [];

function startGateStub(status = 200) {
  gateRequests = [];
  gateServer = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      gateRequests.push({ headers: req.headers, body: body === "" ? null : JSON.parse(body) });
      res.setHeader("Content-Type", "application/json");
      res.statusCode = status;
      res.end(JSON.stringify(status === 200 ? VERDICT : { error: "unauthorized" }));
    });
  });
  return new Promise((resolve) => gateServer.listen(0, () => resolve(`http://127.0.0.1:${gateServer.address().port}`)));
}

function startMcp(env) {
  const child = spawn(process.execPath, [MCP_ENTRY], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  child.on('exit', (code, signal) => console.log('MCP CHILD EXIT:', code, 'signal:', signal));
  const lines = [];
  let buffer = "";
  const waiters = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line === "") continue;
      const message = JSON.parse(line);
      const waiterIndex = waiters.findIndex((w) => w.match(message));
      if (waiterIndex !== -1) {
        const [waiter] = waiters.splice(waiterIndex, 1);
        waiter.resolve(message);
      } else {
        lines.push(message);
      }
    }
  });
  child.stderr.on("data", () => { /* diagnostics ignored */ });
  return {
    send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    waitFor(match, timeoutMs = 8000) {
      const existing = lines.findIndex(match);
      if (existing !== -1) return Promise.resolve(lines.splice(existing, 1)[0]);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${JSON.stringify(match)}`)), timeoutMs);
        waiters.push({ match, resolve: (message) => { clearTimeout(timer); resolve(message); } });
      });
    },
  };
}

afterEach(() => {
  for (const child of children) child.kill();
  children = [];
  if (gateServer) {
    gateServer.close();
    gateServer = undefined;
  }
});

describe("CartGuard MCP server (stdio JSON-RPC)", () => {
  it("initializes with protocol version and server info", async () => {
    const gateUrl = await startGateStub();
    const mcp = startMcp({ GATE_URL: gateUrl, GATE_API_KEY: "k" });
    mcp.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    const response = await mcp.waitFor((m) => m.id === 1);
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("cartguard-gate");
  });

  it("lists the propose_purchase tool", async () => {
    const gateUrl = await startGateStub();
    const mcp = startMcp({ GATE_URL: gateUrl, GATE_API_KEY: "k" });
    mcp.send({ jsonrpc: "2.0", id: 2, method: "initialize" });
    await mcp.waitFor((m) => m.id === 2);
    mcp.send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const response = await mcp.waitFor((m) => m.id === 3);
    const names = response.result.tools.map((tool) => tool.name);
    expect(names).toEqual(["propose_purchase"]);
  });

  it("bridges tools/call to the gate API with the configured key", async () => {
    const gateUrl = await startGateStub();
    const mcp = startMcp({ GATE_URL: gateUrl, GATE_API_KEY: "gate-secret" });
    mcp.send({ jsonrpc: "2.0", id: 4, method: "initialize" });
    await mcp.waitFor((m) => m.id === 4);
    mcp.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "propose_purchase",
        arguments: {
          goal: "earbuds under $60",
          budget: 60,
          product_id: "demo-earbuds-1",
          stated_price: 1,
          rationale: "fits",
          goal_match_score: 0.9,
        },
      },
    });
    const response = await mcp.waitFor((m) => m.id === 5);
    expect(response.result.structuredContent.verdict).toBe("auto_pay");
    expect(response.result.structuredContent.priceUsed).toBe(21.99);
    expect(gateRequests[0].headers["x-api-key"]).toBe("gate-secret");
    expect(gateRequests[0].body.proposal.product_id).toBe("demo-earbuds-1");
  });

  it("returns a tool error when the gate rejects the key", async () => {
    const gateUrl = await startGateStub(401);
    const mcp = startMcp({ GATE_URL: gateUrl, GATE_API_KEY: "wrong" });
    mcp.send({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "propose_purchase", arguments: { goal: "g", budget: 1, product_id: "x", rationale: "r", goal_match_score: 0.5 } } });
    const response = await mcp.waitFor((m) => m.id === 6);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("HTTP 401");
  });

  it("reports a tool error when GATE_API_KEY is unset", async () => {
    const gateUrl = await startGateStub();
    const mcp = startMcp({ GATE_URL: gateUrl });
    mcp.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "propose_purchase", arguments: { goal: "g", budget: 1, product_id: "x", rationale: "r", goal_match_score: 0.5 } } });
    const response = await mcp.waitFor((m) => m.id === 7);
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0].text).toContain("GATE_API_KEY");
  });
});
