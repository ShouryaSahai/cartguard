import { runRedTeam } from "../src/redteam/suite.js";
import { writeFileSync, mkdirSync } from "node:fs";

// CartGuard red-team scorecard runner.
//   npm run redteam -w @cartguard/api
// Prints a results table + pass rate and writes redteam-results.md.

const results = await runRedTeam();
const passed = results.filter((result) => result.passed).length;
const total = results.length;
const rate = ((passed / total) * 100).toFixed(1);

const ICON = (ok: boolean): string => (ok ? "✅ PASS" : "❌ FAIL");
console.log("\nCARTGUARD RED-TEAM SCORECARD");
console.log("=".repeat(78));
let category = "";
for (const result of results) {
  if (result.category !== category) {
    category = result.category;
    console.log(`\n── ${category.toUpperCase()} ──`);
  }
  console.log(`${ICON(result.passed)} ${result.id.padEnd(8)} ${result.name}`);
  if (!result.passed) console.log(`         ↳ ${result.detail}`);
}
console.log("\n" + "=".repeat(78));
console.log(`PASS RATE: ${passed}/${total} (${rate}%)`);

const byCategory = new Map<string, { passed: number; total: number }>();
for (const result of results) {
  const bucket = byCategory.get(result.category) ?? { passed: 0, total: 0 };
  bucket.total += 1;
  if (result.passed) bucket.passed += 1;
  byCategory.set(result.category, bucket);
}

const lines = [
  "# CartGuard red-team scorecard",
  "",
  `**${passed}/${total} attacks stopped (${rate}% pass rate).**`,
  "",
  "Every attack is deterministic and runs offline against the real policy gate,",
  "agent loop, and pipeline — hostile product text, manipulated prices, hostile",
  "LLM behavior, and direct gate abuse. The LLM has no payment tool; only the",
  "gate or an explicit human approval can reach PayPal.",
  "",
  "| Category | Stopped |",
  "| --- | --- |",
  ...[...byCategory.entries()].map(
    ([name, bucket]) => `| ${name} | ${bucket.passed}/${bucket.total} |`,
  ),
  "",
  "| ID | Attack | Result |",
  "| --- | --- | --- |",
  ...results.map(
    (result) =>
      `| ${result.id} | ${result.name} | ${result.passed ? "✅" : `❌ ${result.detail}`} |`,
  ),
  "",
];
mkdirSync("redteam", { recursive: true });
writeFileSync("redteam/redteam-results.md", lines.join("\n"));
console.log("report written to apps/api/redteam/redteam-results.md");
process.exit(passed === total ? 0 : 1);
