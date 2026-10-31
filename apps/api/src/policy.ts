import { strictest } from "@cartguard/shared";
import type {
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

  const verdict = reasons.reduce<Verdict>(
    (acc, reason) => strictest(acc, reason.outcome),
    "auto_pay",
  );
  return { verdict, reasons, priceUsed: price };
}
