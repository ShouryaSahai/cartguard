#!/usr/bin/env node
// A second agent proving CartGuard is infrastructure: it proposes a purchase
// through the gate API and prints the verdict. The gate re-verifies the price
// and decides — this agent has no way to move money by itself.
//
//   GATE_URL=http://localhost:3000 GATE_API_KEY=... node examples/second-agent.mjs

import { CartGateClient } from "../packages/gate-client/index.mjs";

const GATE_URL = process.env.GATE_URL ?? "http://localhost:3000";
const GATE_API_KEY = process.env.GATE_API_KEY ?? "";
if (GATE_API_KEY === "") {
  console.error("Set GATE_API_KEY (must match the CartGuard server's GATE_API_KEY).");
  process.exit(1);
}
const gate = new CartGateClient({ gateUrl: GATE_URL, apiKey: GATE_API_KEY });

const proposal = {
  goal: process.argv[2] ?? "Wireless earbuds under $60 with good reviews",
  budget: Number(process.argv[3] ?? "60"),
  search_median_price: Number(process.argv[4] ?? "25") || null,
  proposal: {
    product_id: process.argv[5] ?? "demo-earbuds-1",
    stated_price: Number(process.argv[6] ?? "1"),
    rationale: "Second-agent demo: cheapest verified in-stock match for the goal.",
    goal_match_score: 0.9,
  },
};

const verdict = await gate.propose(proposal);
console.log(`verdict: ${verdict.verdict} | status: ${verdict.status} | verified price: $${verdict.priceUsed.toFixed(2)}`);
console.log(`request: ${verdict.requestId}`);
if (verdict.approvalLink !== null) console.log(`approval link: ${verdict.approvalLink}`);
for (const reason of verdict.reasons) console.log(`- [${reason.rule}] ${reason.message}`);
