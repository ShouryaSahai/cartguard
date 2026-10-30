import "../src/env.js";
import { runAgent } from "../src/agent.js";
import { createChannel3Client } from "../src/channel3.js";
import { createLlmCompleter } from "../src/llm.js";

// Live smoke test for the agent loop: real Gemini, real Channel3, no money path.
// Run with: npm run smoke:agent -w @cartguard/api

const goal = process.argv[2] ?? "wireless earbuds under $60 with good reviews";
const budget = Number(process.argv[3] ?? "60");
if (!Number.isFinite(budget) || budget <= 0) {
  console.error("budget must be a positive number");
  process.exit(1);
}

const llm = createLlmCompleter();
const channel3 = createChannel3Client();

console.log(`goal: ${goal} | budget: $${budget.toFixed(2)}\n`);
const outcome = await runAgent(goal, budget, { llm, channel3 });

console.log(`status: ${outcome.status} | median: ${outcome.searchMedianPrice ?? "n/a"}`);
for (const entry of outcome.trace) {
  const prefix = entry.kind.toUpperCase().padEnd(15, " ");
  console.log(`[${prefix}] ${entry.text.slice(0, 220)}`);
}
if (outcome.proposal !== null) {
  const { productId, llmStatedPrice, goalMatchScore, rationale } = outcome.proposal;
  console.log(
    `\nPROPOSAL -> ${productId} | llm-stated price: ${llmStatedPrice ?? "n/a"} (never trusted) | match: ${goalMatchScore.toFixed(2)}\nrationale: ${rationale}`,
  );
}
