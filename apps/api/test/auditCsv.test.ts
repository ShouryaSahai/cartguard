import { describe, expect, it } from "vitest";
import { auditToCsv } from "../src/auditCsv.js";
import { openDb } from "../src/db.js";
import type { AuditRow } from "../src/db.js";

function row(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 1,
    requestId: "req-1",
    step: "gate",
    productId: "p1",
    merchant: "adorama.com",
    priceUsd: 21.99,
    verdict: "auto_pay",
    reasons: [],
    llmRationale: null,
    paypalOrderId: null,
    paypalStatus: null,
    mandateId: null,
    demo: false,
    ts: "2026-10-31T00:00:00.000Z",
    ...overrides,
  };
}

describe("audit CSV export", () => {
  it("emits a header plus one line per row", () => {
    const csv = auditToCsv([row(), row({ id: 2, verdict: "blocked" })]);
    const lines = csv.trimEnd().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe("audit_id,request_id,step,product_id,merchant,price_usd,verdict,paypal_status,mandate_id,ts");
    expect(lines[1]).toContain("auto_pay");
    expect(lines[2]).toContain("blocked");
  });

  it("escapes quotes and commas per RFC 4180", () => {
    const csv = auditToCsv([row({ merchant: 'shop with "quotes", and commas' })]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[1]).toContain('"shop with ""quotes"", and commas"');
  });

  it("renders nulls as empty cells", () => {
    const csv = auditToCsv([row({ priceUsd: null, paypalStatus: null })]);
    const cells = csv.trimEnd().split("\n")[1]!.split(",");
    expect(cells[5]).toBe('""');
    expect(cells[7]).toBe('""');
  });

  it("round-trips from a real database", () => {
    const db = openDb(":memory:");
    db.createRequest("r1", "goal", 60, "0".repeat(64));
    db.appendAudit({
      requestId: "r1",
      step: "gate",
      productId: "p1",
      merchant: "adorama.com",
      priceUsd: 30,
      verdict: "auto_pay",
      reasons: [],
      llmRationale: null,
      paypalOrderId: null,
      paypalStatus: null,
    });
    const csv = auditToCsv(db.listAudit(100));
    db.close();
    expect(csv.trimEnd().split("\n").length).toBe(2);
    expect(csv).toContain("adorama.com");
  });
});
