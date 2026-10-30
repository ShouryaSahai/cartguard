import { describe, expect, it } from "vitest";
import type { Channel3Client } from "../src/channel3.js";
import { decidePurchase } from "../src/gate.js";
import { DEFAULT_POLICY, type NormalizedProduct, type PurchaseProposal } from "@cartguard/shared";

function product(id: string, price: number, overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  const offer = {
    url: "https://adorama.com/p",
    domain: "adorama.com",
    price,
    compareAtPrice: null,
    currency: "USD",
    availability: "InStock",
    inStock: true,
  };
  return {
    id,
    title: "Acme Earbuds",
    description: "",
    brand: "Acme",
    categorySlug: "headphones",
    image: null,
    rating: 4.5,
    offers: [offer],
    bestOffer: offer,
    ...overrides,
  };
}

function proposal(productId = "a1", goalMatchScore = 0.9): PurchaseProposal {
  return {
    productId,
    llmStatedPrice: 1,
    rationale: "matches the goal",
    goalMatchScore,
  };
}

function channel3With(verified: NormalizedProduct | null): Channel3Client {
  return {
    searchProducts: async () => {
      throw new Error("not used by the gate");
    },
    getProduct: async () => verified,
  };
}

const BASE = {
  goal: "earbuds under $60",
  budget: 60,
  spentThisWeek: 0,
  searchMedianPrice: null,
  config: DEFAULT_POLICY,
};

describe("gate: price trust boundary", () => {
  it("uses the re-verified Channel3 price and ignores the LLM's stated price", async () => {
    const decision = await decidePurchase(
      { ...BASE, proposal: proposal("a1") },
      { channel3: channel3With(product("a1", 30)) },
    );
    expect(decision.priceUsed).toBe(30);
    expect(decision.verdict).toBe("auto_pay");
    expect(decision.verifiedProduct!.id).toBe("a1");
  });

  it("blocks when the product cannot be re-verified (LLM ids are not trusted)", async () => {
    const decision = await decidePurchase(
      { ...BASE, proposal: proposal("ghost-id") },
      { channel3: channel3With(null) },
    );
    expect(decision.verdict).toBe("blocked");
    expect(decision.priceUsed).toBe(0);
    expect(decision.verifiedProduct).toBeNull();
  });

  it("blocks when the product API throws", async () => {
    const channel3: Channel3Client = {
      searchProducts: async () => {
        throw new Error("unused");
      },
      getProduct: async () => {
        throw new Error("HTTP 503");
      },
    };
    const decision = await decidePurchase({ ...BASE, proposal: proposal("a1") }, { channel3 });
    expect(decision.verdict).toBe("blocked");
  });
});

describe("gate: policy outcomes flow through", () => {
  it("needs approval when the verified price exceeds the per-purchase cap", async () => {
    const decision = await decidePurchase(
      { ...BASE, budget: 500, proposal: proposal("a1") },
      { channel3: channel3With(product("a1", 150)) },
    );
    expect(decision.verdict).toBe("needs_approval");
    expect(decision.reasons.some((r) => r.rule === "per_purchase_cap")).toBe(true);
    expect(decision.priceUsed).toBe(150);
  });

  it("blocks when the verified price exceeds the budget", async () => {
    const decision = await decidePurchase(
      { ...BASE, proposal: proposal("a1") },
      { channel3: channel3With(product("a1", 90)) },
    );
    expect(decision.verdict).toBe("blocked");
    expect(decision.reasons.some((r) => r.rule === "budget")).toBe(true);
  });

  it("blocks a blocklisted category found on re-verification", async () => {
    const decision = await decidePurchase(
      { ...BASE, proposal: proposal("a1") },
      { channel3: channel3With(product("a1", 30, { categorySlug: "weapons" })) },
    );
    expect(decision.verdict).toBe("blocked");
    expect(decision.reasons.some((r) => r.rule === "category_blocklist")).toBe(true);
  });

  it("needs approval on a low goal-match score from the proposal", async () => {
    const decision = await decidePurchase(
      { ...BASE, proposal: proposal("a1", 0.2) },
      { channel3: channel3With(product("a1", 30)) },
    );
    expect(decision.verdict).toBe("needs_approval");
    expect(decision.reasons.some((r) => r.rule === "goal_mismatch")).toBe(true);
  });

  it("blocks an out-of-stock product even if the LLM said it was fine", async () => {
    const p = product("a1", 30);
    p.bestOffer = { ...p.bestOffer!, inStock: false, availability: "OutOfStock" };
    const decision = await decidePurchase(
      { ...BASE, proposal: proposal("a1") },
      { channel3: channel3With(p) },
    );
    expect(decision.verdict).toBe("blocked");
  });
});

describe("gate: weekly spend context", () => {
  it("needs approval when this purchase would breach the weekly cap", async () => {
    const decision = await decidePurchase(
      { ...BASE, proposal: proposal("a1"), spentThisWeek: 480 },
      { channel3: channel3With(product("a1", 30)) },
    );
    expect(decision.verdict).toBe("needs_approval");
    expect(decision.reasons.some((r) => r.rule === "weekly_cap")).toBe(true);
  });
});
