import type { AuditRow } from "./db.js";

// CSV export of the audit table — the source for real usage numbers in the
// Devpost write-up (requests, blocks, attacks stopped).

const HEADER = [
  "audit_id",
  "request_id",
  "step",
  "product_id",
  "merchant",
  "price_usd",
  "verdict",
  "paypal_status",
  "mandate_id",
  "ts",
];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function auditToCsv(rows: AuditRow[]): string {
  const lines = [HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.requestId,
        row.step,
        row.productId,
        row.merchant,
        row.priceUsd,
        row.verdict,
        row.paypalStatus,
        row.mandateId,
        row.ts,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
