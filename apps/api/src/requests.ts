import { decidePurchase } from "./gate.js";
import { runAgent } from "./agent.js";
import type { CartGuardDb, RequestStatus } from "./db.js";
import type { Channel3Client } from "./channel3.js";
import type { ChatCompleter } from "./llm.js";
import type { PaypalOrders } from "./paypal.js";

export interface PipelineDeps {
  db: CartGuardDb;
  llm: ChatCompleter;
  channel3: Channel3Client;
  /** Null when PayPal credentials are missing or invalid: requests still get
   * agent + gate verdicts, but cannot move money until the rail is configured. */
  paypal: PaypalOrders | null;
  publicBaseUrl: string;
  brandName: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function startRequestProcessing(
  requestId: string,
  goal: string,
  budget: number,
  deps: PipelineDeps,
): void {
  void processRequest(requestId, goal, budget, deps).catch((error: unknown) => {
    deps.db.finishRequest(requestId, "failed", null, null, null);
    deps.db.appendAudit({
      requestId,
      step: "pipeline",
      productId: null,
      merchant: null,
      priceUsd: null,
      verdict: "failed",
      reasons: [],
      llmRationale: errorMessage(error),
      paypalOrderId: null,
      paypalStatus: null,
    });
  });
}

export async function processRequest(
  requestId: string,
  goal: string,
  budget: number,
  deps: PipelineDeps,
): Promise<void> {
  deps.db.setRequestStatus(requestId, "running");

  const outcome = await runAgent(goal, budget, { llm: deps.llm, channel3: deps.channel3 });
  deps.db.setRequestTrace(requestId, outcome.trace);

  if (outcome.status !== "proposed" || outcome.proposal === null) {
    const lastTrace = outcome.trace.at(-1)?.text ?? null;
    deps.db.finishRequest(requestId, "failed", null, null, null);
    deps.db.appendAudit({
      requestId,
      step: "agent",
      productId: null,
      merchant: null,
      priceUsd: null,
      verdict: outcome.status,
      reasons: [],
      llmRationale: lastTrace,
      paypalOrderId: null,
      paypalStatus: null,
    });
    return;
  }

  const proposal = outcome.proposal;
  const config = deps.db.getPolicy();
  const decision = await decidePurchase(
    {
      goal,
      budget,
      proposal,
      spentThisWeek: deps.db.weeklyCapturedSpend(new Date()),
      searchMedianPrice: outcome.searchMedianPrice,
      config,
    },
    { channel3: deps.channel3 },
  );

  const verified = decision.verifiedProduct;
  deps.db.appendAudit({
    requestId,
    step: "gate",
    productId: verified?.id ?? proposal.productId,
    merchant: verified?.bestOffer?.domain ?? null,
    priceUsd: decision.priceUsed,
    verdict: decision.verdict,
    reasons: decision.reasons,
    llmRationale: proposal.rationale,
    paypalOrderId: null,
    paypalStatus: null,
  });

  if (decision.verdict === "blocked") {
    deps.db.finishRequest(requestId, "blocked", verified, null, null);
    return;
  }

  // From here on, only the gate's approval stands between the proposal and
  // PayPal. This is the single money path in the entire codebase.
  if (deps.paypal === null) {
    deps.db.finishRequest(requestId, "needs_approval", verified, null, null);
    deps.db.appendAudit({
      requestId,
      step: "payment",
      productId: verified?.id ?? null,
      merchant: verified?.bestOffer?.domain ?? null,
      priceUsd: decision.priceUsed,
      verdict: "needs_approval",
      reasons: [],
      llmRationale: "Payment rail unavailable: PayPal credentials missing or invalid.",
      paypalOrderId: null,
      paypalStatus: "UNAVAILABLE",
    });
    return;
  }

  const returnUrl = `${deps.publicBaseUrl}/paypal/return?request_id=${encodeURIComponent(requestId)}`;
  const cancelUrl = `${deps.publicBaseUrl}/?canceled=${encodeURIComponent(requestId)}`;
  const vaultOnSuccess = decision.verdict === "auto_pay";

  try {
    const order = await deps.paypal.createOrder({
      amountUsd: decision.priceUsed,
      returnUrl,
      cancelUrl,
      brandName: deps.brandName,
      vaultOnSuccess,
    });

    if (decision.verdict === "auto_pay") {
      try {
        const capture = await deps.paypal.captureOrder(order.orderId);
        if (capture.status === "COMPLETED") {
          deps.db.finishRequest(requestId, "captured", verified, order.orderId, null);
          deps.db.appendAudit({
            requestId,
            step: "payment",
            productId: verified?.id ?? null,
            merchant: verified?.bestOffer?.domain ?? null,
            priceUsd: decision.priceUsed,
            verdict: "auto_pay",
            reasons: [],
            llmRationale: proposal.rationale,
            paypalOrderId: order.orderId,
            paypalStatus: "CAPTURED",
          });
          return;
        }
        deps.db.finishRequest(requestId, "needs_approval", verified, order.orderId, order.approvalUrl);
        deps.db.appendAudit({
          requestId,
          step: "payment",
          productId: verified?.id ?? null,
          merchant: verified?.bestOffer?.domain ?? null,
          priceUsd: decision.priceUsed,
          verdict: "needs_approval",
          reasons: [],
          llmRationale: proposal.rationale,
          paypalOrderId: order.orderId,
          paypalStatus: capture.status,
        });
        return;
      } catch (captureError: unknown) {
        // PRD fallback: sandbox wallet orders need buyer approval unless a
        // vaulted token exists. auto_pay degrades to one-click approval.
        deps.db.finishRequest(requestId, "needs_approval", verified, order.orderId, order.approvalUrl);
        deps.db.appendAudit({
          requestId,
          step: "payment",
          productId: verified?.id ?? null,
          merchant: verified?.bestOffer?.domain ?? null,
          priceUsd: decision.priceUsed,
          verdict: "needs_approval",
          reasons: [],
          llmRationale: errorMessage(captureError),
          paypalOrderId: order.orderId,
          paypalStatus: "APPROVAL_REQUIRED",
        });
        return;
      }
    }

    deps.db.finishRequest(requestId, "needs_approval", verified, order.orderId, order.approvalUrl);
    deps.db.appendAudit({
      requestId,
      step: "payment",
      productId: verified?.id ?? null,
      merchant: verified?.bestOffer?.domain ?? null,
      priceUsd: decision.priceUsed,
      verdict: "needs_approval",
      reasons: [],
      llmRationale: proposal.rationale,
      paypalOrderId: order.orderId,
      paypalStatus: "CREATED",
    });
  } catch (createError: unknown) {
    const status: RequestStatus = "failed";
    deps.db.finishRequest(requestId, status, verified, null, null);
    deps.db.appendAudit({
      requestId,
      step: "payment",
      productId: verified?.id ?? null,
      merchant: verified?.bestOffer?.domain ?? null,
      priceUsd: decision.priceUsed,
      verdict: "failed",
      reasons: [],
      llmRationale: errorMessage(createError),
      paypalOrderId: null,
      paypalStatus: null,
    });
  }
}
