import { strictest } from "@cartguard/shared";
import type {
  MandateRuntime,
  NormalizedProduct,
  PolicyConfig,
  PolicyInput,
  PolicyReason,
  PolicyResult,
  Verdict,
} from "@cartguard/shared";

export const RULES = {
  budget: "budget",
  perPurchaseCap: "per_purchase_cap",
  weeklyCap: "weekly_cap",
  priceAnomalyHigh: "price_anomaly_high",
  priceAnomalyLow: "price_anomaly_low",
  merchantAllowlist: "merchant_allowlist",
  categoryBlocklist: "category_blocklist",
  productUnavailable: "product_unavailable",
  goalMismatch: "goal_mismatch",
  nonUsdOffer: "non_usd_offer",
  mandateRevoked: "mandate_revoked",
  mandateExpired: "mandate_expired",
  mandateExhausted: "mandate_exhausted",
  mandateBudget: "mandate_budget_exceeded",
  mandateMerchant: "mandate_merchant",
  mandateCategory: "mandate_category",
} as const;

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function evaluatePolicy(input: PolicyInput, config: PolicyConfig): PolicyResult {
  const reasons: PolicyReason[] = [];
  const product: NormalizedProduct = input.product;
  const best = product.bestOffer;
  const price = best?.price ?? 0;
  const merchant = (best?.domain ?? "").toLowerCase();
  const category = product.categorySlug.toLowerCase();

  if (best !== null) {
    if (best.currency.toUpperCase() !== "USD") {
      reasons.push({
        rule: RULES.nonUsdOffer,
        outcome: "blocked",
        message: `Non-USD offer (${best.currency}) — refusing to charge a foreign-currency amount as USD.`,
      });
    }
    if (price > input.budget) {
      reasons.push({
        rule: RULES.budget,
        outcome: "blocked",
        message: `Price ${usd(price)} exceeds the goal budget of ${usd(input.budget)}.`,
      });
    }
    if (price > config.perPurchaseCap) {
      reasons.push({
        rule: RULES.perPurchaseCap,
        outcome: "needs_approval",
        message: `Price ${usd(price)} exceeds the per-purchase cap of ${usd(config.perPurchaseCap)}.`,
      });
    }
    if (input.spentThisWeek + price > config.weeklyCap) {
      reasons.push({
        rule: RULES.weeklyCap,
        outcome: "needs_approval",
        message: `Weekly spend ${usd(input.spentThisWeek)} plus this price ${usd(price)} would exceed the ${usd(config.weeklyCap)} weekly cap.`,
      });
    }
    if (input.searchMedianPrice !== null) {
      const medianPrice = input.searchMedianPrice;
      if (price > config.priceMultiplierHigh * medianPrice) {
        reasons.push({
          rule: RULES.priceAnomalyHigh,
          outcome: "needs_approval",
          message: `Price ${usd(price)} is more than ${config.priceMultiplierHigh}x the ${usd(medianPrice)} median of search results.`,
        });
      } else if (price < config.priceMultiplierLow * medianPrice) {
        reasons.push({
          rule: RULES.priceAnomalyLow,
          outcome: "needs_approval",
          message: `Price ${usd(price)} is suspiciously cheap: below ${config.priceMultiplierLow}x the ${usd(medianPrice)} median of search results.`,
        });
      }
    }
    if (
      config.allowlistMerchants.length > 0 &&
      !config.allowlistMerchants.some((m) => m.toLowerCase() === merchant)
    ) {
      reasons.push({
        rule: RULES.merchantAllowlist,
        outcome: "needs_approval",
        message: `Merchant "${best.domain}" is not on the allowlist.`,
      });
    }
  }

  if (config.blocklistCategories.some((c) => c.toLowerCase() === category)) {
    reasons.push({
      rule: RULES.categoryBlocklist,
      outcome: "blocked",
      message: `Category "${product.categorySlug}" is blocklisted.`,
    });
  }

  if (best === null || !best.inStock) {
    reasons.push({
      rule: RULES.productUnavailable,
      outcome: "blocked",
      message: "Product is unavailable or out of stock.",
    });
  }

  if (input.goalMatchScore !== null && input.goalMatchScore < config.goalMatchThreshold) {
    reasons.push({
      rule: RULES.goalMismatch,
      outcome: "needs_approval",
      message: `Agent pick may not match the goal: similarity ${input.goalMatchScore.toFixed(2)} is below the ${config.goalMatchThreshold} threshold.`,
    });
  }

  // Spending-mandate rules (additive): an expired, revoked, or exhausted
  // mandate blocks; a merchant outside the mandate's allowlist escalates.
  const mandate: MandateRuntime | null = input.mandate ?? null;
  if (mandate !== null) {
    if (mandate.revoked) {
      reasons.push({
        rule: RULES.mandateRevoked,
        outcome: "blocked",
        message: `Mandate ${mandate.id} is revoked or missing.`,
      });
    }
    if (mandate.expiresAt !== null && mandate.nowIso > mandate.expiresAt) {
      reasons.push({
        rule: RULES.mandateExpired,
        outcome: "blocked",
        message: `Mandate ${mandate.id} expired at ${mandate.expiresAt}.`,
      });
    }
    if (mandate.maxItems !== null && mandate.itemsUsed >= mandate.maxItems) {
      reasons.push({
        rule: RULES.mandateExhausted,
        outcome: "blocked",
        message: `Mandate ${mandate.id} is exhausted: ${mandate.itemsUsed} of ${mandate.maxItems} allowed items used.`,
      });
    }
    if (mandate.spentUnderMandate + price > mandate.budgetUsd) {
      reasons.push({
        rule: RULES.mandateBudget,
        outcome: "blocked",
        message: `Mandate ${mandate.id} budget exceeded: ${usd(mandate.spentUnderMandate)} spent plus ${usd(price)} would pass ${usd(mandate.budgetUsd)}.`,
      });
    }
    if (
      mandate.allowedMerchants.length > 0 &&
      !mandate.allowedMerchants.some((m) => m.toLowerCase() === merchant)
    ) {
      reasons.push({
        rule: RULES.mandateMerchant,
        outcome: "needs_approval",
        message: `Merchant "${best?.domain ?? ""}" is outside mandate ${mandate.id}'s allowlist.`,
      });
    }
    if (mandate.blocklistCategories.some((c) => c.toLowerCase() === category)) {
      reasons.push({
        rule: RULES.mandateCategory,
        outcome: "blocked",
        message: `Category "${product.categorySlug}" is blocklisted by mandate ${mandate.id}.`,
      });
    }
  }

  const verdict = reasons.reduce<Verdict>(
    (acc, reason) => strictest(acc, reason.outcome),
    "auto_pay",
  );
  return { verdict, reasons, priceUsed: price };
}
