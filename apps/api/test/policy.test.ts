import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../src/policy.js";
import type {
  MandateRuntime,
  NormalizedProduct,
  Offer,
  PolicyConfig,
  PolicyInput,
} from "@cartguard/shared";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    url: "https://adorama.com/p/tw-e5b",
    domain: "adorama.com",
    price: 50,
    compareAtPrice: null,
    currency: "USD",
    availability: "InStock",
    inStock: true,
    ...overrides,
  };
}

function product(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    id: "p1",
    title: "Yamaha TW-E5B Earbuds",
    description: "True wireless earbuds",
    brand: "Yamaha",
    categorySlug: "headphones",
    image: null,
    rating: 4.5,
    offers: [offer()],
    bestOffer: offer(),
    ...overrides,
  };
}

const CONFIG: PolicyConfig = {
  perPurchaseCap: 100,
  weeklyCap: 500,
  allowlistMerchants: [],
  blocklistCategories: ["weapons"],
  priceMultiplierHigh: 1.5,
  priceMultiplierLow: 0.4,
  goalMatchThreshold: 0.6,
};

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    goal: "wireless earbuds under $60",
    budget: 60,
    product: product(),
    spentThisWeek: 0,
    searchMedianPrice: null,
    goalMatchScore: null,
    ...overrides,
  };
}

describe("policy: budget rule", () => {
  it("auto_pays a normal small purchase", () => {
    const result = evaluatePolicy(input(), CONFIG);
    expect(result.verdict).toBe("auto_pay");
    expect(result.reasons).toEqual([]);
    expect(result.priceUsed).toBe(50);
  });

  it("blocks when price exceeds budget", () => {
    const result = evaluatePolicy(input({ budget: 40 }), CONFIG);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "budget")).toBe(true);
  });

  it("allows a price exactly equal to the budget (boundary)", () => {
    const result = evaluatePolicy(input({ budget: 50 }), CONFIG);
    expect(result.verdict).toBe("auto_pay");
  });

  it("scales priceUsed with the verified offer, not the LLM claim", () => {
    const p = product({ bestOffer: offer({ price: 42.5 }) });
    const result = evaluatePolicy(input({ product: p }), CONFIG);
    expect(result.priceUsed).toBe(42.5);
  });
});

describe("policy: per-purchase cap rule", () => {
  it("needs approval when price exceeds the per-purchase cap", () => {
    const result = evaluatePolicy(input({ product: product({ bestOffer: offer({ price: 150 }) }), budget: 200 }), CONFIG);
    expect(result.verdict).toBe("needs_approval");
    expect(result.reasons.some((r) => r.rule === "per_purchase_cap")).toBe(true);
  });

  it("auto_pays at exactly the per-purchase cap (boundary)", () => {
    const result = evaluatePolicy(input({ product: product({ bestOffer: offer({ price: 100 }) }), budget: 200 }), CONFIG);
    expect(result.verdict).toBe("auto_pay");
  });
});

describe("policy: weekly cap rule", () => {
  it("needs approval when weekly spend plus price exceeds the weekly cap", () => {
    const result = evaluatePolicy(input({ spentThisWeek: 470 }), CONFIG);
    expect(result.verdict).toBe("needs_approval");
    expect(result.reasons.some((r) => r.rule === "weekly_cap")).toBe(true);
  });

  it("auto_pays when weekly spend plus price equals the cap (boundary)", () => {
    const result = evaluatePolicy(input({ spentThisWeek: 450 }), CONFIG);
    expect(result.verdict).toBe("auto_pay");
  });
});

describe("policy: price anomaly vs search median", () => {
  it("needs approval when price is far above the median (overpaying)", () => {
    const result = evaluatePolicy(input({ product: product({ bestOffer: offer({ price: 90 }) }), budget: 200, searchMedianPrice: 50 }), CONFIG);
    expect(result.verdict).toBe("needs_approval");
    expect(result.reasons.some((r) => r.rule === "price_anomaly_high")).toBe(true);
  });

  it("needs approval when price is suspiciously cheap vs the median", () => {
    const result = evaluatePolicy(input({ product: product({ bestOffer: offer({ price: 15 }) }), searchMedianPrice: 50 }), CONFIG);
    expect(result.verdict).toBe("needs_approval");
    expect(result.reasons.some((r) => r.rule === "price_anomaly_low")).toBe(true);
  });

  it("skips the anomaly rule when no median is provided", () => {
    const result = evaluatePolicy(input({ searchMedianPrice: null }), CONFIG);
    expect(result.reasons.filter((r) => r.rule.startsWith("price_anomaly"))).toEqual([]);
  });

  it("auto_pays at exactly the high multiplier boundary", () => {
    const result = evaluatePolicy(input({ product: product({ bestOffer: offer({ price: 75 }) }), budget: 200, searchMedianPrice: 50 }), CONFIG);
    expect(result.verdict).toBe("auto_pay");
  });
});

describe("policy: merchant allowlist rule", () => {
  it("needs approval for a merchant outside a non-empty allowlist", () => {
    const result = evaluatePolicy(input(), { ...CONFIG, allowlistMerchants: ["macys.com"] });
    expect(result.verdict).toBe("needs_approval");
    expect(result.reasons.some((r) => r.rule === "merchant_allowlist")).toBe(true);
  });

  it("auto_pays for a merchant on the allowlist (case-insensitive)", () => {
    const p = product({ bestOffer: offer({ domain: "Macys.com" }) });
    const result = evaluatePolicy(input({ product: p }), { ...CONFIG, allowlistMerchants: ["macys.com"] });
    expect(result.verdict).toBe("auto_pay");
  });

  it("allows any merchant when the allowlist is empty", () => {
    const result = evaluatePolicy(input(), CONFIG);
    expect(result.reasons.some((r) => r.rule === "merchant_allowlist")).toBe(false);
  });
});

describe("policy: category blocklist rule", () => {
  it("blocks a blocklisted category", () => {
    const p = product({ categorySlug: "weapons", bestOffer: offer({ price: 30 }) });
    const result = evaluatePolicy(input({ product: p }), CONFIG);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "category_blocklist")).toBe(true);
  });

  it("matches blocklisted categories case-insensitively", () => {
    const p = product({ categorySlug: "Weapons" });
    const result = evaluatePolicy(input({ product: p }), CONFIG);
    expect(result.verdict).toBe("blocked");
  });
});

describe("policy: availability rule", () => {
  it("blocks when the best offer is out of stock", () => {
    const p = product({ bestOffer: offer({ inStock: false, availability: "OutOfStock" }) });
    const result = evaluatePolicy(input({ product: p }), CONFIG);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "product_unavailable")).toBe(true);
  });

  it("blocks when the product has no offers at all", () => {
    const p = product({ offers: [], bestOffer: null });
    const result = evaluatePolicy(input({ product: p }), CONFIG);
    expect(result.verdict).toBe("blocked");
  });
});

describe("policy: goal mismatch rule", () => {
  it("needs approval when the LLM similarity flag is below threshold", () => {
    const result = evaluatePolicy(input({ goalMatchScore: 0.3 }), CONFIG);
    expect(result.verdict).toBe("needs_approval");
    expect(result.reasons.some((r) => r.rule === "goal_mismatch")).toBe(true);
  });

  it("ignores a high similarity score", () => {
    const result = evaluatePolicy(input({ goalMatchScore: 0.95 }), CONFIG);
    expect(result.verdict).toBe("auto_pay");
  });
});

describe("policy: strictest verdict wins", () => {
  it("escalates needs_approval to blocked when another rule blocks", () => {
    const p = product({ bestOffer: offer({ price: 150, inStock: false }), categorySlug: "headphones" });
    const result = evaluatePolicy(input({ product: p, budget: 200 }), CONFIG);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("reports every triggered rule, not just the first", () => {
    const p = product({ bestOffer: offer({ price: 150 }), categorySlug: "weapons" });
    const result = evaluatePolicy(input({ product: p, budget: 200 }), CONFIG);
    const rules = result.reasons.map((r) => r.rule);
    expect(rules).toContain("per_purchase_cap");
    expect(rules).toContain("category_blocklist");
  });
});

describe("policy: currency rule", () => {
  it("blocks a JPY-only offer instead of charging it as USD", () => {
    const p = product({ bestOffer: offer({ currency: "JPY", price: 2000 }) });
    const result = evaluatePolicy(input({ product: p, budget: 60 }), CONFIG);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "non_usd_offer")).toBe(true);
  });

  it("blocks an EUR-only offer", () => {
    const p = product({ bestOffer: offer({ currency: "EUR", price: 25 }) });
    const result = evaluatePolicy(input({ product: p, budget: 60 }), CONFIG);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "non_usd_offer")).toBe(true);
  });

  it("still auto_pays a USD offer", () => {
    const result = evaluatePolicy(input(), CONFIG);
    expect(result.verdict).toBe("auto_pay");
  });

  it("matches the currency case-insensitively", () => {
    const p = product({ bestOffer: offer({ currency: "usd", price: 30 }) });
    const result = evaluatePolicy(input({ product: p, budget: 60 }), CONFIG);
    expect(result.verdict).toBe("auto_pay");
  });

  it("blocks a non-USD offer even when every other rule would pass", () => {
    const p = product({ bestOffer: offer({ currency: "GBP", price: 10 }) });
    const result = evaluatePolicy(input({ product: p, budget: 60, goalMatchScore: 0.99 }), CONFIG);
    expect(result.verdict).toBe("blocked");
  });
});

describe("policy: spending mandates (additive rules)", () => {
  const NOW = "2026-11-01T12:00:00.000Z";
  function mandate(overrides: Partial<MandateRuntime> = {}): MandateRuntime {
    return {
      id: "m-1",
      budgetUsd: 100,
      expiresAt: null,
      revoked: false,
      maxItems: null,
      itemsUsed: 0,
      spentUnderMandate: 0,
      allowedMerchants: [],
      blocklistCategories: [],
      nowIso: NOW,
      ...overrides,
    };
  }

  it("blocks a revoked mandate", () => {
    const result = evaluatePolicy(input({ mandate: mandate({ revoked: true }) }), CONFIG);
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "mandate_revoked")).toBe(true);
  });

  it("blocks an expired mandate", () => {
    const result = evaluatePolicy(
      input({ mandate: mandate({ expiresAt: "2026-10-01T00:00:00.000Z" }) }),
      CONFIG,
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "mandate_expired")).toBe(true);
  });

  it("auto_pays inside the mandate window", () => {
    const result = evaluatePolicy(
      input({ mandate: mandate({ expiresAt: "2026-12-01T00:00:00.000Z" }) }),
      CONFIG,
    );
    expect(result.verdict).toBe("auto_pay");
  });

  it("blocks when max items is exhausted", () => {
    const result = evaluatePolicy(
      input({ mandate: mandate({ maxItems: 2, itemsUsed: 2 }) }),
      CONFIG,
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "mandate_exhausted")).toBe(true);
  });

  it("blocks when the mandate budget would be exceeded", () => {
    const result = evaluatePolicy(
      input({ mandate: mandate({ budgetUsd: 40 }) }),
      CONFIG,
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "mandate_budget_exceeded")).toBe(true);
  });

  it("needs approval for a merchant outside the mandate allowlist", () => {
    const result = evaluatePolicy(
      input({ mandate: mandate({ allowedMerchants: ["macys.com"] }) }),
      CONFIG,
    );
    expect(result.verdict).toBe("needs_approval");
    expect(result.reasons.some((r) => r.rule === "mandate_merchant")).toBe(true);
  });

  it("blocks a mandate-blocklisted category", () => {
    const p = product({ categorySlug: "tobacco" });
    const result = evaluatePolicy(
      input({ product: p, mandate: mandate({ blocklistCategories: ["tobacco"] }) }),
      CONFIG,
    );
    expect(result.verdict).toBe("blocked");
    expect(result.reasons.some((r) => r.rule === "mandate_category")).toBe(true);
  });
});

describe("policy: determinism", () => {
  it("gives the same verdict for the same input, every time", () => {
    const a = input({ searchMedianPrice: 55, goalMatchScore: 0.8 });
    expect(evaluatePolicy(a, CONFIG)).toEqual(evaluatePolicy(a, CONFIG));
  });
});
