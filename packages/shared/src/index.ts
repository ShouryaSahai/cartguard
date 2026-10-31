import { z } from "zod";

// ---------- Verdicts ----------

export const VerdictSchema = z.enum(["auto_pay", "needs_approval", "blocked"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const VERDICT_STRICTNESS: Record<Verdict, number> = {
  auto_pay: 0,
  needs_approval: 1,
  blocked: 2,
};

export function strictest(a: Verdict, b: Verdict): Verdict {
  return VERDICT_STRICTNESS[a] >= VERDICT_STRICTNESS[b] ? a : b;
}

// ---------- Channel3 raw API shapes (only the fields we consume) ----------

export const Channel3PriceSchema = z.object({
  price: z.number(),
  compare_at_price: z.number().nullable().optional(),
  currency: z.string(),
});

export const Channel3OfferSchema = z.object({
  url: z.string().nullable().optional(),
  domain: z.string(),
  price: Channel3PriceSchema,
  availability: z.string().nullable().optional(),
  condition: z.string().nullable().optional(),
  max_commission_rate: z.number().nullable().optional(),
});

export const Channel3ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  brands: z.array(z.object({ id: z.string().nullable().optional(), name: z.string().nullable().optional() })).nullable().optional(),
  images: z
    .array(
      z.object({
        url: z.string().nullable().optional(),
        cleaned_url: z.string().nullable().optional(),
        is_main_image: z.boolean().nullable().optional(),
        shot_type: z.string().nullable().optional(),
        alt_text: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  category: z
    .object({
      slug: z.string().optional(),
      title: z.string().optional(),
      path: z.array(z.object({ slug: z.string(), title: z.string() })).optional(),
      has_children: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  offers: z.array(Channel3OfferSchema).nullable().optional(),
  ratings: z
    .object({
      value: z.number().optional(),
      count: z.number().optional(),
      source_count: z.number().optional(),
    })
    .nullable()
    .optional(),
});
export type Channel3Product = z.infer<typeof Channel3ProductSchema>;

export const Channel3SearchResponseSchema = z.object({
  // Items are parsed one-by-one as strict Channel3ProductSchema downstream, so
  // a single malformed product is skipped instead of failing the whole search.
  products: z.array(z.unknown()).default([]),
  next_page_token: z.string().optional(),
});

// ---------- Normalized product (CartGuard canonical shape) ----------

export const OfferSchema = z.object({
  url: z.string(),
  domain: z.string(),
  price: z.number(),
  compareAtPrice: z.number().nullable(),
  currency: z.string(),
  availability: z.string(),
  inStock: z.boolean(),
});
export type Offer = z.infer<typeof OfferSchema>;

export const NormalizedProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  brand: z.string(),
  categorySlug: z.string(),
  image: z.string().nullable(),
  rating: z.number().nullable(),
  offers: z.array(OfferSchema),
  bestOffer: OfferSchema.nullable(),
});
export type NormalizedProduct = z.infer<typeof NormalizedProductSchema>;

const OUT_OF_STOCK_PATTERN =
  /out\s*_?\s*of\s*_?\s*stock|sold\s*_?\s*out|unavailable|discontinued/i;

export function isInStock(availability: string | null | undefined): boolean {
  if (availability === undefined || availability === null) return true;
  if (availability.trim() === "") return true;
  return !OUT_OF_STOCK_PATTERN.test(availability);
}

export function normalizeChannel3Product(raw: Channel3Product): NormalizedProduct {
  const offers: Offer[] = (raw.offers ?? []).map((o) => ({
    url: o.url ?? "",
    domain: o.domain,
    price: o.price.price,
    compareAtPrice: o.price.compare_at_price ?? null,
    currency: o.price.currency,
    availability: o.availability ?? "",
    inStock: isInStock(o.availability),
  }));
  const usdOffers = offers.filter((o) => o.currency.toUpperCase() === "USD");
  const pool = usdOffers.length > 0 ? usdOffers : offers;
  const inStockPool = pool.filter((o) => o.inStock);
  const byPrice = (a: Offer, b: Offer): number => a.price - b.price;
  const bestOffer =
    [...inStockPool].sort(byPrice)[0] ?? [...pool].sort(byPrice)[0] ?? null;
  const mainImage =
    raw.images?.find((i) => i.is_main_image === true) ?? raw.images?.[0];
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? "",
    brand: raw.brands?.[0]?.name ?? "",
    categorySlug: raw.category?.slug ?? "",
    image: mainImage?.cleaned_url ?? mainImage?.url ?? null,
    rating: raw.ratings?.value ?? null,
    offers,
    bestOffer,
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1] ?? 0;
  return (lo + hi) / 2;
}

// ---------- Policy ----------

export const PolicyConfigSchema = z.object({
  perPurchaseCap: z.number().positive().finite(),
  weeklyCap: z.number().positive().finite(),
  allowlistMerchants: z.array(z.string()).default([]),
  blocklistCategories: z.array(z.string()).default([]),
  priceMultiplierHigh: z.number().positive().default(1.5),
  priceMultiplierLow: z.number().positive().default(0.4),
  goalMatchThreshold: z.number().min(0).max(1).default(0.6),
});
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

export const DEFAULT_POLICY: PolicyConfig = PolicyConfigSchema.parse({
  perPurchaseCap: 100,
  weeklyCap: 500,
  blocklistCategories: ["weapons", "tobacco", "alcohol", "fireworks"],
});

export const PolicyReasonSchema = z.object({
  rule: z.string(),
  outcome: VerdictSchema,
  message: z.string(),
});
export type PolicyReason = z.infer<typeof PolicyReasonSchema>;

// Runtime view of a spending mandate, stamped by the caller (nowIso keeps
// evaluatePolicy deterministic).
export const MandateRuntimeSchema = z.object({
  id: z.string(),
  budgetUsd: z.number().nonnegative().finite(),
  expiresAt: z.string().nullable(),
  revoked: z.boolean(),
  maxItems: z.number().int().positive().nullable(),
  itemsUsed: z.number().int().nonnegative().default(0),
  spentUnderMandate: z.number().nonnegative().default(0),
  allowedMerchants: z.array(z.string()).default([]),
  blocklistCategories: z.array(z.string()).default([]),
  nowIso: z.string(),
});
export type MandateRuntime = z.infer<typeof MandateRuntimeSchema>;

export const PolicyInputSchema = z.object({
  goal: z.string().min(1),
  budget: z.number().nonnegative().finite(),
  product: NormalizedProductSchema,
  spentThisWeek: z.number().nonnegative().default(0),
  searchMedianPrice: z.number().positive().nullable().default(null),
  goalMatchScore: z.number().min(0).max(1).nullable().default(null),
  mandate: MandateRuntimeSchema.nullable().optional(),
});
export type PolicyInput = z.infer<typeof PolicyInputSchema>;

export const PolicyResultSchema = z.object({
  verdict: VerdictSchema,
  reasons: z.array(PolicyReasonSchema),
  priceUsed: z.number(),
});
export type PolicyResult = z.infer<typeof PolicyResultSchema>;

// ---------- Agent (LLM) contracts ----------

export const PurchaseProposalSchema = z.object({
  productId: z.string().min(1),
  llmStatedPrice: z.number().nonnegative().nullable(),
  rationale: z.string().min(1),
  goalMatchScore: z.number().min(0).max(1),
});
export type PurchaseProposal = z.infer<typeof PurchaseProposalSchema>;

export const AgentStepKindSchema = z.enum([
  "assistant_text",
  "tool_call",
  "tool_result",
  "proposal",
  "error",
]);
export type AgentStepKind = z.infer<typeof AgentStepKindSchema>;

export const AgentStepSchema = z.object({
  step: z.number().int().nonnegative(),
  kind: AgentStepKindSchema,
  text: z.string(),
});
export type AgentStep = z.infer<typeof AgentStepSchema>;

export const AgentStatusSchema = z.enum([
  "proposed",
  "no_proposal",
  "no_products",
  "max_steps_exceeded",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const AgentOutcomeSchema = z.object({
  status: AgentStatusSchema,
  proposal: PurchaseProposalSchema.nullable(),
  productsSeen: z.array(NormalizedProductSchema),
  searchMedianPrice: z.number().nullable(),
  trace: z.array(AgentStepSchema),
});
export type AgentOutcome = z.infer<typeof AgentOutcomeSchema>;
