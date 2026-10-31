import { mkdirSync } from "node:fs";
import path from "node:path";
import "../src/env.js";
import { openDb } from "../src/db.js";
import { seedDemoData } from "../src/demoSeedData.js";

// Seeds the three demo paths so the dashboard never looks empty.
//   npm run seed:demo -w @cartguard/api

const dbPath = process.env.DB_PATH ?? "data/cartguard.sqlite";
mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
const db = openDb(dbPath);
seedDemoData(db);
db.close();
console.log(`Demo data seeded into ${dbPath}`);
