import { writeFileSync } from "node:fs";
import "../src/env.js";
import { auditToCsv } from "../src/auditCsv.js";
import { openDb } from "../src/db.js";

// Exports the audit table to CSV for real usage numbers.
//   npm run export:audit -w @cartguard/api [outfile]

const dbPath = process.env.DB_PATH ?? "data/cartguard.sqlite";
const outFile = process.argv[2] ?? "audit-export.csv";

const db = openDb(dbPath);
const csv = auditToCsv(db.listAudit(1_000_000));
db.close();

writeFileSync(outFile, csv);
const rowCount = Math.max(csv.trimEnd().split("\n").length - 1, 0);
console.log(`exported ${rowCount} audit rows to ${outFile}`);
