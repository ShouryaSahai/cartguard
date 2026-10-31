#!/usr/bin/env node
// A second agent proving CartGuard is infrastructure: it proposes a purchase
// through the gate API and prints the verdict. The gate re-verifies the price
// and decides — this agent has no way to move money by itself.
//
//   GATE_URL=http://localhost:3000 GATE_API_KEY=... node examples/second-agent.mjs

const GATE_URL = (process.env.GATE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const GATE_API_KEY = process.env.GATE_API_KEY ?? "";
if (GATE_API_KEY === "") {
  console.error("Set GATE_API_KEY (must match the CartGuard server's GATE_API_KEY).");
  process.exit(1);
}

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

const response = await fetch(`${GATE_URL}/gate/propose`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": GATE_API_KEY },
  body: JSON.stringify(proposal),
});
const body = await response.json();
console.log(`HTTP ${response.status}`);
console.log(JSON.stringify(body, null, 2));
