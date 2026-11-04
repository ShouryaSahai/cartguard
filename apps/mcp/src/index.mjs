#!/usr/bin/env node
// CartGuard Gate — MCP server (stdio, JSON-RPC 2.0).
// Bridges the propose_purchase tool to the CartGuard gate API so ANY agent
// can route a purchase through the policy gate. One code path to PayPal:
// this server never talks to PayPal itself — it calls POST /gate/propose.
//
// Env:
//   GATE_URL      base URL of the CartGuard API   (default http://localhost:3000)
//   GATE_API_KEY  shared secret for the gate API  (required)

import { createInterface } from "node:readline";

const GATE_URL = (process.env.GATE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const GATE_API_KEY = process.env.GATE_API_KEY ?? "";

const TOOL = {
  name: "propose_purchase",
  description:
    "Submit a purchase proposal to CartGuard's policy gate. The gate re-verifies the price from product data and decides auto_pay, needs_approval, or blocked. Your stated price is informational only. Returns the verdict, reasons, and (for needs_approval) the buyer approval link.",
  inputSchema: {
    type: "object",
    properties: {
      goal: { type: "string", description: "The shopping goal this purchase fulfils" },
      budget: { type: "number", description: "Budget in USD" },
      product_id: { type: "string", description: "Product id from the product API" },
      stated_price: { type: "number", description: "Price you believe applies (informational only)" },
      rationale: { type: "string", description: "Why this product fits the goal" },
      goal_match_score: { type: "number", description: "0-1 self-assessed similarity to the goal" },
      search_median_price: { type: "number", description: "Median price of your search results, if known" },
    },
    required: ["goal", "budget", "product_id", "rationale", "goal_match_score"],
  },
};

function jsonRpc(id, result) {
  return JSON.stringify({ jsonrpc: "2.0", id, result });
}
function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

async function callGate(args) {
  if (GATE_API_KEY === "") {
    throw new Error("GATE_API_KEY is not set — the gate cannot be called");
  }
  const response = await fetch(`${GATE_URL}/gate/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": GATE_API_KEY },
    body: JSON.stringify({
      goal: args.goal,
      budget: args.budget,
      search_median_price: args.search_median_price ?? null,
      proposal: {
        product_id: args.product_id,
        stated_price: args.stated_price ?? null,
        rationale: args.rationale,
        goal_match_score: args.goal_match_score,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`gate returned HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body;
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed === "") return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  const { id, method, params } = message;
  if (method === "initialize") {
    process.stdout.write(
      jsonRpc(id, {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "cartguard-gate", version: "1.0.0" },
      }),
    );
    return;
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
  if (method === "tools/list") {
    process.stdout.write(jsonRpc(id, { tools: [TOOL] }));
    return;
  }
  if (method === "tools/call") {
    if (params?.name !== "propose_purchase") {
      process.stdout.write(jsonRpcError(id, -32602, `Unknown tool: ${params?.name}`));
      return;
    }
    callGate(params?.arguments ?? {})
      .then((result) => {
        process.stdout.write(
          jsonRpc(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          }),
        );
      })
      .catch((error) => {
        process.stdout.write(
          jsonRpc(id, {
            content: [{ type: "text", text: `Gate error: ${error.message}` }],
            isError: true,
          }),
        );
      });
    return;
  }
  if (id !== undefined) {
    process.stdout.write(jsonRpcError(id, -32601, `Unknown method: ${method}`));
  }
});
