import type { AgentStep, PolicyReason } from "@cartguard/shared";
import { DEMO_SEED_PRODUCTS } from "./demoSeed.js";
import type { CartGuardDb } from "./db.js";

// Seeds the three demo paths (auto_pay / needs_approval / blocked) so the
// dashboard never looks empty on first boot. Offline and clearly fictional.

function traceFor(kind: "captured" | "needs_approval" | "blocked"): AgentStep[] {
  const trace: AgentStep[] = [
    { step: 1, kind: "tool_call", text: 'search_products {"query":"demo wireless earbuds"}' },
    { step: 1, kind: "tool_result", text: '{"median_price_usd":21.99,"products":[demo dataset]}' },
    { step: 2, kind: "tool_call", text: 'get_product {"product_id":"demo-earbuds-1"}' },
    { step: 3, kind: "proposal", text: "demo-earbuds-1 (match 0.95): cheapest in-stock verified match" },
  ];
  if (kind === "blocked") {
    trace.push({ step: 4, kind: "tool_result", text: "gate: blocked by policy" });
  }
  return trace;
}

export function seedDemoData(db: CartGuardDb): void {
  const earbuds = DEMO_SEED_PRODUCTS[0]!;
  const laptop = DEMO_SEED_PRODUCTS[1]!;
  const bait = DEMO_SEED_PRODUCTS[2]!;

  const demos: Array<{
    id: string;
    goal: string;
    budget: number;
    status: "captured" | "needs_approval" | "blocked";
    productIndex: number;
    price: number;
    verdict: string;
    reasons: PolicyReason[];
    paypalOrderId: string | null;
    paypalStatus: string | null;
    approvalUrl: string | null;
  }> = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      goal: "Wireless earbuds under $60 with good reviews",
      budget: 60,
      status: "captured",
      productIndex: 0,
      price: earbuds.bestOffer!.price,
      verdict: "auto_pay",
      reasons: [],
      paypalOrderId: "DEMO-ORD-CAPTURE-1",
      paypalStatus: "CAPTURED",
      approvalUrl: null,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      goal: "Laptop around $400 for uni",
      budget: 450,
      status: "needs_approval",
      productIndex: 1,
      price: laptop.bestOffer!.price,
      verdict: "needs_approval",
      reasons: [
        {
          rule: "per_purchase_cap",
          outcome: "needs_approval",
          message: "Price $389.00 exceeds the per-purchase cap of $100.00.",
        },
      ],
      paypalOrderId: "DEMO-ORD-APPROVAL-2",
      paypalStatus: "CREATED",
      approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=DEMO-ORD-APPROVAL-2",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      goal: "Noise-cancelling headphones under $20",
      budget: 20,
      status: "blocked",
      productIndex: 2,
      price: bait.bestOffer!.price,
      verdict: "blocked",
      reasons: [
        {
          rule: "price_anomaly_low",
          outcome: "needs_approval",
          message: "Price $18.50 is suspiciously cheap: below 0.4x the $120.00 median of search results.",
        },
        {
          rule: "merchant_allowlist",
          outcome: "needs_approval",
          message: 'Merchant "sketchy-shop.example" is not on the allowlist.',
        },
      ],
      paypalOrderId: null,
      paypalStatus: null,
      approvalUrl: null,
    },
  ];

  for (const demo of demos) {
    if (db.getRequest(demo.id) !== null) continue; // idempotent seeding
    const product = DEMO_SEED_PRODUCTS[demo.productIndex]!;
    db.createRequest(demo.id, demo.goal, demo.budget, "seeded-demo-no-token");
    db.setRequestTrace(demo.id, traceFor(demo.status));
    db.setRequestStatus(demo.id, demo.status);
    db.finishRequest(demo.id, demo.status, product, demo.paypalOrderId, demo.approvalUrl);
    db.appendAudit({
      requestId: demo.id,
      step: "gate",
      productId: product.id,
      merchant: product.bestOffer?.domain ?? null,
      priceUsd: demo.price,
      verdict: demo.verdict,
      reasons: demo.reasons,
      llmRationale: "Seeded demo row — not a live run.",
      paypalOrderId: null,
      paypalStatus: null,
    });
    if (demo.paypalStatus !== null) {
      db.appendAudit({
        requestId: demo.id,
        step: "payment",
        productId: product.id,
        merchant: product.bestOffer?.domain ?? null,
        priceUsd: demo.price,
        verdict: demo.verdict,
        reasons: [],
        llmRationale: null,
        paypalOrderId: demo.paypalOrderId,
        paypalStatus: demo.paypalStatus,
      });
    }
  }
}
