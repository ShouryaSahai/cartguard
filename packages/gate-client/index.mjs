/**
 * CartGateClient — the 20-line integration that lets ANY agent route
 * purchases through CartGuard's policy gate. The gate re-verifies prices
 * and decides; this client can never move money by itself.
 *
 *   import { CartGateClient } from "@cartguard/gate-client";
 *   const gate = new CartGateClient({ gateUrl: "https://cartguard.example", apiKey: process.env.GATE_API_KEY });
 *   const verdict = await gate.propose({ goal, budget, proposal: { product_id, stated_price, rationale, goal_match_score } });
 *   // verdict: { requestId, status, verdict, reasons, priceUsed, approvalLink, paypalOrderId, productId }
 */
export class CartGateClient {
  /**
   * @param {{ gateUrl?: string, apiKey: string }} options
   */
  constructor(options) {
    this.gateUrl = (options.gateUrl ?? "http://localhost:3000").replace(/\/+$/, "");
    this.apiKey = options.apiKey ?? "";
    if (this.apiKey === "") throw new Error("apiKey is required (the GATE_API_KEY configured on the CartGuard server)");
  }

  /**
   * Submit a purchase proposal for gate review.
   * @param {{
   *   goal: string,
   *   budget: number,
   *   proposal: {
   *     product_id: string,
   *     stated_price?: number | null,
   *     rationale: string,
   *     goal_match_score: number,
   *   },
   *   search_median_price?: number | null,
   *   mandate_id?: string | null,
   * }} request
   * @returns {Promise<{ requestId: string, status: string, verdict: string, reasons: Array<{rule: string, outcome: string, message: string}>, priceUsed: number, approvalLink: string | null, paypalOrderId: string | null, productId: string | null }>}
   */
  async propose(request) {
    const response = await fetch(`${this.gateUrl}/gate/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({
        goal: request.goal,
        budget: request.budget,
        search_median_price: request.search_median_price ?? null,
        mandate_id: request.mandate_id ?? null,
        proposal: {
          product_id: request.proposal.product_id,
          stated_price: request.proposal.stated_price ?? null,
          rationale: request.proposal.rationale,
          goal_match_score: request.proposal.goal_match_score,
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`CartGuard gate rejected the proposal: HTTP ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
    }
    return body;
  }
}
