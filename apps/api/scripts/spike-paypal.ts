import "../src/env.js";
import { createPaypalOrdersFromEnv } from "../src/paypal.js";

// M1 spike (PRD): PayPal sandbox order create + capture behavior + Vault
// acceptance. Runs through the real production client. Day-1 decision output:
//   1. Do orders with vault-on-success attributes get accepted?
//   2. Does capture work without buyer approval? (expected: no for wallet orders)
//   3. What is the one-click approval link for the sandbox buyer?

const paypal = createPaypalOrdersFromEnv();

console.log("M1 SPIKE: PayPal sandbox order create + capture + vault");
console.log("=".repeat(64));

let order;
try {
  order = await paypal.createOrder({
    amountUsd: 21.99,
    returnUrl: "http://localhost:3000/paypal/return?request_id=spike-m1",
    cancelUrl: "http://localhost:3000/?canceled=spike-m1",
    brandName: "CartGuard",
    vaultOnSuccess: true,
  });
} catch (error: unknown) {
  console.log("❌ order create FAILED:", error instanceof Error ? error.message.slice(0, 300) : error);
  process.exit(1);
}

console.log(`✅ order created: ${order.orderId} (status ${order.status})`);
console.log(`✅ vault-on-success attributes accepted by the sandbox API`);
console.log(`approval link: ${order.approvalUrl ?? "(none returned)"}`);

if (order.approvalUrl !== null) {
  try {
    const capture = await paypal.captureOrder(order.orderId);
    console.log(`⚠️ capture WITHOUT buyer approval returned: ${capture.status}`);
    console.log("   decision: true no-click auto-pay may be possible in sandbox");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`✅ capture without approval rejected (expected for wallet orders):`);
    console.log(`   ${message.slice(0, 220)}`);
    console.log("\nDAY-1 DECISION (PRD §7 fallback):");
    console.log("  auto_pay = agent-prepared checkout: zero in-app confirmation,");
    console.log("  buyer does a one-click PayPal approval; after the first vaulted");
    console.log("  approval, later orders can charge the saved token with no click.");
  }
}

console.log("\nNEXT: open the approval link in a browser, approve with the sandbox");
console.log("PERSONAL account, and CartGuard's /paypal/return captures the order —");
console.log("with store-in-vault ON_SUCCESS, that approval also saves a payment token.");
