import { decidePurchase } from "./gate.js";
import { runAgent } from "./agent.js";
import type { CartGuardDb, RequestStatus } from "./db.js";
import type { Channel3Client } from "./channel3.js";
import type { ChatCompleter } from "./llm.js";
import type { PaypalOrders } from "./paypal.js";
import type { MandateRuntime, PolicyReason, PurchaseProposal, Verdict } from "@cartguard/shared";

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

/** Outcome of running a verified proposal through the gate + payment rail. */
export interface GateExecutionResult {
  status: RequestStatus;
  verdict: Verdict;
  reasons: PolicyReason[];
  priceUsed: number;
  approvalUrl: string | null;
  paypalOrderId: string | null;
  productId: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Loads the mandate and stamps the runtime view the policy evaluates. A
 * referenced-but-missing mandate is treated as revoked (blocks the purchase). */
function buildMandateView(deps: PipelineDeps, mandateId: string): MandateRuntime {
  const row = deps.db.getMandate(mandateId);
  if (row === null) {
    return {
      id: mandateId,
      budgetUsd: 0,
      expiresAt: null,
      revoked: true,
      maxItems: null,
      itemsUsed: 0,
      spentUnderMandate: 0,
      allowedMerchants: [],
      blocklistCategories: [],
      nowIso: new Date().toISOString(),
    };
  }
  return {
    id: row.id,
    budgetUsd: row.budgetUsd,
    expiresAt: row.expiresAt,
    revoked: row.revoked,
    maxItems: row.maxItems,
    itemsUsed: deps.db.countCapturedItems(row.id),
    spentUnderMandate: deps.db.spentUnderMandate(row.id),
    allowedMerchants: row.allowedMerchants,
    blocklistCategories: row.blocklistCategories,
    nowIso: new Date().toISOString(),
  };
}

/** Best-effort: after a completed store-in-vault capture, save the payment
 * token so future auto_pay verdicts can charge it with no buyer click. */
export async function rememberVaultToken(deps: PipelineDeps, orderId: string): Promise<void> {
  if (deps.paypal === null) return;
  try {
    const vaultId = await deps.paypal.getVaultId(orderId);
    if (vaultId !== null) deps.db.setSetting("paypal_vault_id", vaultId);
  } catch {
    // Token extraction is opportunistic; the one-click fallback still works.
  }
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
  const mandateId = deps.db.getRequest(requestId)?.mandateId ?? null;

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

  await executeProposal(deps, requestId, goal, budget, outcome.proposal, outcome.searchMedianPrice, mandateId);
}

/** The gate + payment execution shared by the internal agent pipeline and the
 * external gate API (POST /gate/propose). ONE code path to PayPal. */
export async function executeProposal(
  deps: PipelineDeps,
  requestId: string,
  goal: string,
  budget: number,
  proposal: PurchaseProposal,
  searchMedianPrice: number | null,
  mandateId: string | null = null,
): Promise<GateExecutionResult> {
  const config = deps.db.getPolicy();
  const mandate: MandateRuntime | null = mandateId === null ? null : buildMandateView(deps, mandateId);
  const decision = await decidePurchase(
    {
      goal,
      budget,
      proposal,
      spentThisWeek: deps.db.weeklyCapturedSpend(new Date()),
      searchMedianPrice,
      config,
      mandate,
    },
    { channel3: deps.channel3 },
  );

  const verified = decision.verifiedProduct;
  deps.db.appendAudit({
    requestId,
    mandateId,
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
    return { status: "blocked", verdict: decision.verdict, reasons: decision.reasons, priceUsed: decision.priceUsed, approvalUrl: null, paypalOrderId: null, productId: verified?.id ?? proposal.productId };
  }

  // From here on, only the gate's approval stands between the proposal and
  // PayPal. This is the single money path in the entire codebase.
  if (deps.paypal === null) {
    deps.db.finishRequest(requestId, "needs_approval", verified, null, null);
    deps.db.appendAudit({
      requestId,
      mandateId,
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
    return { status: "needs_approval", verdict: "needs_approval", reasons: [], priceUsed: decision.priceUsed, approvalUrl: null, paypalOrderId: null, productId: verified?.id ?? null };
  }

  const returnUrl = `${deps.publicBaseUrl}/paypal/return?request_id=${encodeURIComponent(requestId)}`;
  const cancelUrl = `${deps.publicBaseUrl}/?canceled=${encodeURIComponent(requestId)}`;
  const vaultOnSuccess = decision.verdict === "auto_pay";
  const savedVaultId = vaultOnSuccess ? (deps.db.getSetting("paypal_vault_id") ?? undefined) : undefined;

  try {
    const order = await deps.paypal.createOrder({
      amountUsd: decision.priceUsed,
      returnUrl,
      cancelUrl,
      brandName: deps.brandName,
      vaultOnSuccess,
      vaultId: savedVaultId,
    });

    if (decision.verdict === "auto_pay") {
      if (order.status === "COMPLETED") {
        await rememberVaultToken(deps, order.orderId);
        deps.db.finishRequest(requestId, "captured", verified, order.orderId, null);
        deps.db.appendAudit({
          requestId,
          mandateId,
          step: "payment",
          productId: verified?.id ?? null,
          merchant: verified?.bestOffer?.domain ?? null,
          priceUsd: decision.priceUsed,
          verdict: "auto_pay",
          reasons: [],
          llmRationale: savedVaultId !== undefined
            ? "Vault token charge completed at order creation — no capture call needed."
            : proposal.rationale,
          paypalOrderId: order.orderId,
          paypalStatus: "CAPTURED",
        });
        return { status: "captured", verdict: "auto_pay", reasons: [], priceUsed: decision.priceUsed, approvalUrl: null, paypalOrderId: order.orderId, productId: verified?.id ?? null };
      }
      try {
        const capture = await deps.paypal.captureOrder(order.orderId);
        if (capture.status === "COMPLETED") {
          await rememberVaultToken(deps, order.orderId);
          deps.db.finishRequest(requestId, "captured", verified, order.orderId, null);
          deps.db.appendAudit({
            requestId,
            mandateId,
            step: "payment",
            productId: verified?.id ?? null,
            merchant: verified?.bestOffer?.domain ?? null,
            priceUsd: decision.priceUsed,
            verdict: "auto_pay",
            reasons: [],
            llmRationale: savedVaultId !== undefined
              ? "Charged the saved PayPal payment token — no buyer click needed."
              : proposal.rationale,
            paypalOrderId: order.orderId,
            paypalStatus: "CAPTURED",
          });
          return { status: "captured", verdict: "auto_pay", reasons: [], priceUsed: decision.priceUsed, approvalUrl: null, paypalOrderId: order.orderId, productId: verified?.id ?? null };
        }
        deps.db.finishRequest(requestId, "needs_approval", verified, order.orderId, order.approvalUrl);
        deps.db.appendAudit({
          requestId,
          mandateId,
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
        return { status: "needs_approval", verdict: "needs_approval", reasons: [], priceUsed: decision.priceUsed, approvalUrl: order.approvalUrl, paypalOrderId: order.orderId, productId: verified?.id ?? null };
      } catch (captureError: unknown) {
        deps.db.finishRequest(requestId, "needs_approval", verified, order.orderId, order.approvalUrl);
        deps.db.appendAudit({
          requestId,
          mandateId,
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
        return { status: "needs_approval", verdict: "needs_approval", reasons: [], priceUsed: decision.priceUsed, approvalUrl: order.approvalUrl, paypalOrderId: order.orderId, productId: verified?.id ?? null };
      }
    }

    deps.db.finishRequest(requestId, "needs_approval", verified, order.orderId, order.approvalUrl);
    deps.db.appendAudit({
      requestId,
      mandateId,
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
    return { status: "needs_approval", verdict: "needs_approval", reasons: [], priceUsed: decision.priceUsed, approvalUrl: order.approvalUrl, paypalOrderId: order.orderId, productId: verified?.id ?? null };
  } catch (createError: unknown) {
    deps.db.finishRequest(requestId, "failed", verified, null, null);
    deps.db.appendAudit({
      requestId,
      mandateId,
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
  return { status: "failed", verdict: "failed" as Verdict, reasons: [] as PolicyReason[], priceUsed: decision.priceUsed, approvalUrl: null, paypalOrderId: null, productId: verified?.id ?? null };
}
