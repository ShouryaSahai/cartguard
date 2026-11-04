export interface GateProposal {
  product_id: string;
  stated_price?: number | null;
  rationale: string;
  goal_match_score: number;
}

export interface GateRequest {
  goal: string;
  budget: number;
  proposal: GateProposal;
  search_median_price?: number | null;
  mandate_id?: string | null;
}

export interface GateVerdict {
  requestId: string;
  status: string;
  verdict: "auto_pay" | "needs_approval" | "blocked" | "failed";
  reasons: Array<{ rule: string; outcome: string; message: string }>;
  priceUsed: number;
  approvalLink: string | null;
  paypalOrderId: string | null;
  productId: string | null;
}

export declare class CartGateClient {
  constructor(options: { gateUrl?: string; apiKey: string });
  propose(request: GateRequest): Promise<GateVerdict>;
}
