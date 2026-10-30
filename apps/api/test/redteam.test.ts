import { describe, expect, it } from "vitest";
import { runRedTeam } from "../src/redteam/suite.js";

// PRD acceptance criteria: "A test proves a malicious LLM response cannot
// cause a payment." The full 35-attack suite runs offline in seconds, so it
// guards every `npm test` run.

describe("red-team suite", () => {
  it("covers at least 30 attacks (PRD minimum)", () => {
    return runRedTeam().then((results) => {
      expect(results.length).toBeGreaterThanOrEqual(30);
    });
  });

  it("stops every attack", async () => {
    const results = await runRedTeam();
    const failed = results.filter((result) => !result.passed);
    expect(failed).toEqual([]);
  });
});
