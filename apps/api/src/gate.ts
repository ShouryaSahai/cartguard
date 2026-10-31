import type {
  MandateRuntime,
  NormalizedProduct,
  PolicyConfig,
  PolicyReason,
  PurchaseProposal,
  Verdict,
} from "@cartguard/shared";
import type { Channel3Client } from "./channel3.js";
import { RULES, evaluatePolicy } from "./policy.js";

// The gate is the ONLY component allowed to decide whether a proposal may
// reach the PayPal client. It never trusts the proposal's stated price: it
// re-fetches the product from Channel3 by id and evaluates policy on that
// verified data. A product that cannot be re-verified is blocked.

export interface GateDeps {
  channel3: Channel3Client;
}

export interface GateInput {
  goal: string;
  budget: number;
  proposal: PurchaseProposal;
  spentThisWeek: number;
  searchMedianPrice: number | null;
  config: PolicyConfig;
  mandate?: MandateRuntime | null;
}

export interface GateDecision {
  verdict: Verdict;
  reasons: PolicyReason[];
  verifiedProduct: NormalizedProduct | null;
  /** Price taken from the re-verified Channel3 offer, never from the LLM. */
  priceUsed: number;
}

export async function decidePurchase(input: GateInput, deps: GateDeps): Promise<GateDecision> {
  let verified: NormalizedProduct | null = null;
  try {
    verified = await deps.channel3.getProduct(input.proposal.productId);
  } catch {
    verified = null;
  }

  if (verified === null) {
    return {
      verdict: "blocked",
      reasons: [
        {
          rule: RULES.productUnavailable,
          outcome: "blocked",
          message: `Product ${input.proposal.productId} could not be re-verified from product data.`,
        },
      ],
      verifiedProduct: null,
      priceUsed: 0,
    };
  }

  const result = evaluatePolicy(
    {
      goal: input.goal,
      budget: input.budget,
      product: verified,
      spentThisWeek: input.spentThisWeek,
      searchMedianPrice: input.searchMedianPrice,
      goalMatchScore: input.proposal.goalMatchScore,
      mandate: input.mandate ?? null,
    },
    input.config,
  );

  return {
    verdict: result.verdict,
    reasons: result.reasons,
    verifiedProduct: verified,
    priceUsed: result.priceUsed,
  };
}
