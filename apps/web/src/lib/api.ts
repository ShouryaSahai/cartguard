import { z } from "zod";
import type { NormalizedProduct, PolicyConfig } from "@cartguard/shared";

// ---------- API contract (mirrors apps/api/src/db.ts rows) ----------

export const AuditRowSchema = z.object({
  id: z.number(),
  requestId: z.string(),
  step: z.string(),
  productId: z.string().nullable(),
  merchant: z.string().nullable(),
  priceUsd: z.number().nullable(),
  verdict: z.string(),
  reasons: z.array(
    z.object({ rule: z.string(), outcome: z.string(), message: z.string() }),
  ),
  llmRationale: z.string().nullable(),
  paypalOrderId: z.string().nullable(),
  paypalStatus: z.string().nullable(),
  ts: z.string(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;

export const RequestDetailSchema = z.object({
  request: z.object({
    id: z.string(),
    goal: z.string(),
    budgetUsd: z.number(),
    status: z.string(),
    chosenProduct: z
      .object({
        id: z.string(),
        title: z.string(),
        brand: z.string(),
        categorySlug: z.string(),
        image: z.string().nullable(),
        rating: z.number().nullable(),
        bestOffer: z
          .object({
            domain: z.string(),
            price: z.number(),
            inStock: z.boolean(),
          })
          .nullable(),
      })
      .nullable(),
    paypalOrderId: z.string().nullable(),
    approvalUrl: z.string().nullable(),
    createdAt: z.string(),
    trace: z.array(
      z.object({ step: z.number(), kind: z.string(), text: z.string() }),
    ),
  }),
  audit: z.array(AuditRowSchema),
  approvalUrl: z.string().nullable(),
});
export type RequestDetail = z.infer<typeof RequestDetailSchema>;

const PolicySchema = z.object({
  perPurchaseCap: z.number(),
  weeklyCap: z.number(),
  allowlistMerchants: z.array(z.string()),
  blocklistCategories: z.array(z.string()),
  priceMultiplierHigh: z.number(),
  priceMultiplierLow: z.number(),
  goalMatchThreshold: z.number(),
});

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Spread init FIRST, then merge headers: caller headers (auth tokens) must
    // not clobber the JSON content type, or the body never parses server-side.
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${path} failed: HTTP ${response.status} ${detail.slice(0, 200)}`);
  }
  return schema.parse(await response.json());
}

export const MandateSchema = z.object({
  id: z.string(),
  budgetUsd: z.number(),
  expiresAt: z.string().nullable(),
  allowedMerchants: z.array(z.string()),
  blocklistCategories: z.array(z.string()),
  maxItems: z.number().nullable(),
  revoked: z.boolean(),
  createdAt: z.string(),
});
export type Mandate = z.infer<typeof MandateSchema>;

export const api = {
  async health(): Promise<{ ok: boolean; paypal: string }> {
    return request(
      "/health",
      z.object({ ok: z.boolean(), paypal: z.string() }),
    );
  },
  async createRequest(goal: string, budget: number): Promise<{ id: string; requestToken: string }> {
    return request(
      "/requests",
      z.object({ id: z.string(), requestToken: z.string() }),
      { method: "POST", body: JSON.stringify({ goal, budget }) },
    );
  },
  getRequest(id: string): Promise<RequestDetail> {
    return request(`/requests/${encodeURIComponent(id)}`, RequestDetailSchema);
  },
  async approve(id: string, requestToken: string): Promise<{ status: string }> {
    return request(`/requests/${encodeURIComponent(id)}/approve`, z.object({ status: z.string() }), {
      method: "POST",
      headers: { "x-request-token": requestToken },
    });
  },
  async reject(id: string, requestToken: string): Promise<{ status: string }> {
    return request(`/requests/${encodeURIComponent(id)}/reject`, z.object({ status: z.string() }), {
      method: "POST",
      headers: { "x-request-token": requestToken },
    });
  },
  async audit(limit = 500): Promise<{ rows: AuditRow[] }> {
    return request(`/audit?limit=${limit}`, z.object({ rows: z.array(AuditRowSchema) }));
  },
  async listMandates(): Promise<{ mandates: Mandate[] }> {
    return request("/mandates", z.object({ mandates: z.array(MandateSchema) }));
  },
  async createMandate(
    mandate: { budgetUsd: number; expiresAt: string | null; allowedMerchants: string[]; blocklistCategories: string[]; maxItems: number | null },
    adminToken: string,
  ): Promise<Mandate> {
    return request("/mandates", MandateSchema, {
      method: "POST",
      body: JSON.stringify(mandate),
      headers: { "x-admin-token": adminToken },
    });
  },
  async revokeMandate(id: string, adminToken: string): Promise<{ revoked: boolean }> {
    return request(`/mandates/${encodeURIComponent(id)}/revoke`, z.object({ revoked: z.boolean() }), {
      method: "POST",
      headers: { "x-admin-token": adminToken },
    });
  },
  async getPolicy(): Promise<PolicyConfig> {
    return request("/policy", PolicySchema);
  },
  async putPolicy(config: PolicyConfig, adminToken: string): Promise<PolicyConfig> {
    return request("/policy", PolicySchema, {
      method: "PUT",
      body: JSON.stringify(config),
      headers: { "x-admin-token": adminToken },
    });
  },
};

export function productLabel(product: NormalizedProduct | null): string {
  if (product === null) return "—";
  return `${product.brand !== "" ? `${product.brand} ` : ""}${product.title}`;
}
