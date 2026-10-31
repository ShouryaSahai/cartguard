import { DatabaseSync } from "node:sqlite";
import { DEFAULT_POLICY } from "@cartguard/shared";
import type {
  AgentStep,
  NormalizedProduct,
  PolicyConfig,
  PolicyReason,
} from "@cartguard/shared";

export const REQUEST_STATUSES = [
  "queued",
  "running",
  "captured",
  "needs_approval",
  "rejected",
  "blocked",
  "failed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface RequestRow {
  id: string;
  goal: string;
  budgetUsd: number;
  status: RequestStatus;
  chosenProduct: NormalizedProduct | null;
  paypalOrderId: string | null;
  approvalUrl: string | null;
  createdAt: string;
  trace: AgentStep[];
  mandateId: string | null;
}

export interface MandateRow {
  id: string;
  budgetUsd: number;
  expiresAt: string | null;
  allowedMerchants: string[];
  blocklistCategories: string[];
  maxItems: number | null;
  revoked: boolean;
  createdAt: string;
}

export interface AuditEntry {
  requestId: string;
  mandateId?: string | null;
  step: string;
  productId: string | null;
  merchant: string | null;
  priceUsd: number | null;
  verdict: string;
  reasons: PolicyReason[];
  llmRationale: string | null;
  paypalOrderId: string | null;
  paypalStatus: string | null;
}

export interface AuditRow extends AuditEntry {
  id: number;
  ts: string;
}

export interface CartGuardDb {
  createRequest(id: string, goal: string, budgetUsd: number, approvalSecretHash: string): void;
  setRequestStatus(id: string, status: RequestStatus): void;
  finishRequest(
    id: string,
    status: RequestStatus,
    chosenProduct: NormalizedProduct | null,
    paypalOrderId: string | null,
    approvalUrl: string | null,
  ): void;
  getRequest(id: string): RequestRow | null;
  setRequestTrace(id: string, trace: AgentStep[]): void;
  getRequestApprovalSecretHash(id: string): string | null;
  setRequestMandate(id: string, mandateId: string): void;
  appendAudit(entry: AuditEntry): void;
  auditForRequest(requestId: string): AuditRow[];
  listAudit(limit: number): AuditRow[];
  getPolicy(): PolicyConfig;
  putPolicy(config: PolicyConfig): void;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  /** Number of requests created at or after the given ISO timestamp. */
  requestsCreatedSince(iso: string): number;
  createMandate(mandate: MandateRow): void;
  getMandate(id: string): MandateRow | null;
  listMandates(): MandateRow[];
  revokeMandate(id: string): void;
  countCapturedItems(mandateId: string): number;
  spentUnderMandate(mandateId: string): number;
  /** Sum of CAPTURED audit-row prices in the last 7 days (PRD weekly spend). */
  weeklyCapturedSpend(now: Date): number;
  close(): void;
}

function table(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      budget_usd REAL NOT NULL,
      status TEXT NOT NULL,
      chosen_product_json TEXT,
      paypal_order_id TEXT,
      approval_url TEXT,
      trace_json TEXT,
      approval_secret_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id TEXT NOT NULL,
      step TEXT NOT NULL,
      product_id TEXT,
      merchant TEXT,
      price_usd REAL,
      verdict TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      llm_rationale TEXT,
      paypal_order_id TEXT,
      paypal_status TEXT,
      ts TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS policy (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY,
      budget_usd REAL NOT NULL,
      expires_at TEXT,
      allowed_merchants TEXT NOT NULL,
      blocklist_categories TEXT NOT NULL,
      max_items INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_request ON audit(request_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
  `);
}

export function openDb(path: string): CartGuardDb {
  const db = new DatabaseSync(path);
  table(db);
  // Lightweight migrations for databases created before these columns existed.
  for (const column of ["trace_json TEXT", "approval_secret_hash TEXT", "mandate_id TEXT"]) {
    try {
      db.exec(`ALTER TABLE requests ADD COLUMN ${column}`);
    } catch {
      // Column already exists.
    }
  }
  try {
    db.exec("ALTER TABLE audit ADD COLUMN mandate_id TEXT");
  } catch {
    // Column already exists.
  }

  return {
    createRequest(id: string, goal: string, budgetUsd: number, approvalSecretHash: string): void {
      db.prepare(
        "INSERT INTO requests (id, goal, budget_usd, status, approval_secret_hash, created_at) VALUES (?, ?, ?, 'queued', ?, ?)",
      ).run(id, goal, budgetUsd, approvalSecretHash, new Date().toISOString());
    },

    getRequestApprovalSecretHash(id: string): string | null {
      const row = db.prepare("SELECT approval_secret_hash FROM requests WHERE id = ?").get(id) as
        | { approval_secret_hash: string | null }
        | undefined;
      return row === undefined || row.approval_secret_hash === null
        ? null
        : row.approval_secret_hash;
    },

    setRequestStatus(id: string, status: RequestStatus): void {
      db.prepare("UPDATE requests SET status = ? WHERE id = ?").run(status, id);
    },

    finishRequest(
      id: string,
      status: RequestStatus,
      chosenProduct: NormalizedProduct | null,
      paypalOrderId: string | null,
      approvalUrl: string | null,
    ): void {
      db.prepare(
        "UPDATE requests SET status = ?, chosen_product_json = ?, paypal_order_id = ?, approval_url = ? WHERE id = ?",
      ).run(
        status,
        chosenProduct === null ? null : JSON.stringify(chosenProduct),
        paypalOrderId,
        approvalUrl,
        id,
      );
    },

    getRequest(id: string): RequestRow | null {
      const row = db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as
        | {
            id: string;
            goal: string;
            budget_usd: number;
            status: string;
            chosen_product_json: string | null;
            paypal_order_id: string | null;
            approval_url: string | null;
            trace_json: string | null;
            mandate_id: string | null;
            created_at: string;
          }
        | undefined;
      if (row === undefined) return null;
      return {
        id: row.id,
        goal: row.goal,
        budgetUsd: row.budget_usd,
        status: row.status as RequestStatus,
        chosenProduct:
          row.chosen_product_json === null
            ? null
            : (JSON.parse(row.chosen_product_json) as NormalizedProduct),
        paypalOrderId: row.paypal_order_id,
        approvalUrl: row.approval_url,
        createdAt: row.created_at,
        trace: row.trace_json === null ? [] : (JSON.parse(row.trace_json) as AgentStep[]),
        mandateId: row.mandate_id ?? null,
      };
    },

    setRequestMandate(id: string, mandateId: string): void {
      db.prepare("UPDATE requests SET mandate_id = ? WHERE id = ?").run(mandateId, id);
    },

    setRequestTrace(id: string, trace: AgentStep[]): void {
      db.prepare("UPDATE requests SET trace_json = ? WHERE id = ?").run(JSON.stringify(trace), id);
    },

    appendAudit(entry: AuditEntry): void {
      db.prepare(
        `INSERT INTO audit (request_id, step, product_id, merchant, price_usd, verdict, reasons_json, llm_rationale, paypal_order_id, paypal_status, mandate_id, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        entry.requestId,
        entry.step,
        entry.productId,
        entry.merchant,
        entry.priceUsd,
        entry.verdict,
        JSON.stringify(entry.reasons),
        entry.llmRationale,
        entry.paypalOrderId,
        entry.paypalStatus,
        entry.mandateId ?? null,
        new Date().toISOString(),
      );
    },

    auditForRequest(requestId: string): AuditRow[] {
      const rows = db
        .prepare("SELECT * FROM audit WHERE request_id = ? ORDER BY id ASC")
        .all(requestId) as Array<Record<string, unknown>>;
      return rows.map(rowToAudit);
    },

    listAudit(limit: number): AuditRow[] {
      const rows = db
        .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT ?")
        .all(limit) as Array<Record<string, unknown>>;
      return rows.map(rowToAudit);
    },

    getPolicy(): PolicyConfig {
      const row = db.prepare("SELECT json FROM policy WHERE id = 1").get() as
        | { json: string }
        | undefined;
      if (row === undefined) return DEFAULT_POLICY;
      return JSON.parse(row.json) as PolicyConfig;
    },

    putPolicy(config: PolicyConfig): void {
      db.prepare(
        "INSERT INTO policy (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json",
      ).run(JSON.stringify(config));
    },

    getSetting(key: string): string | null {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
        | { value: string }
        | undefined;
      return row === undefined ? null : row.value;
    },

    setSetting(key: string, value: string): void {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, value);
    },

    createMandate(mandate: MandateRow): void {
      db.prepare(
        "INSERT INTO mandates (id, budget_usd, expires_at, allowed_merchants, blocklist_categories, max_items, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        mandate.id,
        mandate.budgetUsd,
        mandate.expiresAt,
        JSON.stringify(mandate.allowedMerchants),
        JSON.stringify(mandate.blocklistCategories),
        mandate.maxItems,
        mandate.revoked ? 1 : 0,
        mandate.createdAt,
      );
    },

    getMandate(id: string): MandateRow | null {
      const row = db.prepare("SELECT * FROM mandates WHERE id = ?").get(id) as
        | {
            id: string;
            budget_usd: number;
            expires_at: string | null;
            allowed_merchants: string;
            blocklist_categories: string;
            max_items: number | null;
            revoked: number;
            created_at: string;
          }
        | undefined;
      if (row === undefined) return null;
      return {
        id: row.id,
        budgetUsd: row.budget_usd,
        expiresAt: row.expires_at,
        allowedMerchants: JSON.parse(row.allowed_merchants) as string[],
        blocklistCategories: JSON.parse(row.blocklist_categories) as string[],
        maxItems: row.max_items,
        revoked: row.revoked === 1,
        createdAt: row.created_at,
      };
    },

    listMandates(): MandateRow[] {
      const rows = db.prepare("SELECT * FROM mandates ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
      return rows.map((r) => {
        const parsed = this as unknown as CartGuardDb;
        void parsed;
        return {
          id: String(r.id),
          budgetUsd: Number(r.budget_usd),
          expiresAt: r.expires_at === null ? null : String(r.expires_at),
          allowedMerchants: JSON.parse(String(r.allowed_merchants)) as string[],
          blocklistCategories: JSON.parse(String(r.blocklist_categories)) as string[],
          maxItems: r.max_items === null ? null : Number(r.max_items),
          revoked: Number(r.revoked) === 1,
          createdAt: String(r.created_at),
        };
      });
    },

    revokeMandate(id: string): void {
      db.prepare("UPDATE mandates SET revoked = 1 WHERE id = ?").run(id);
    },

    countCapturedItems(mandateId: string): number {
      const row = db
        .prepare("SELECT COUNT(DISTINCT request_id) AS n FROM audit WHERE mandate_id = ? AND paypal_status = 'CAPTURED'")
        .get(mandateId) as { n: number };
      return row.n;
    },

    spentUnderMandate(mandateId: string): number {
      const row = db
        .prepare("SELECT COALESCE(SUM(price_usd), 0) AS total FROM audit WHERE mandate_id = ? AND paypal_status = 'CAPTURED'")
        .get(mandateId) as { total: number };
      return row.total;
    },

    requestsCreatedSince(iso: string): number {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM requests WHERE created_at >= ?")
        .get(iso) as { n: number };
      return row.n;
    },

    weeklyCapturedSpend(now: Date): number {
      const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const row = db
        .prepare("SELECT COALESCE(SUM(price_usd), 0) AS total FROM audit WHERE paypal_status = 'CAPTURED' AND ts >= ?")
        .get(since) as { total: number };
      return row.total;
    },

    close(): void {
      db.close();
    },
  };
}

function rowToAudit(row: Record<string, unknown>): AuditRow {
  return {
    id: Number(row.id),
    requestId: String(row.request_id),
    step: String(row.step),
    productId: row.product_id === null ? null : String(row.product_id),
    merchant: row.merchant === null ? null : String(row.merchant),
    priceUsd: row.price_usd === null ? null : Number(row.price_usd),
    verdict: String(row.verdict),
    reasons: JSON.parse(String(row.reasons_json)) as PolicyReason[],
    llmRationale: row.llm_rationale === null ? null : String(row.llm_rationale),
    paypalOrderId: row.paypal_order_id === null ? null : String(row.paypal_order_id),
    paypalStatus: row.paypal_status === null ? null : String(row.paypal_status),
    mandateId: row.mandate_id === null || row.mandate_id === undefined ? null : String(row.mandate_id),
    ts: String(row.ts),
  };
}
