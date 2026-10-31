import { DEMO_SEED_PRODUCTS } from "./demoSeed.js";
import type { Channel3Client } from "./channel3.js";
import type { ChatCompleter, LlmMessage, LlmReply, LlmTool } from "./llm.js";
import type { PaypalOrders } from "./paypal.js";

// Deterministic mock rails for Playwright end-to-end tests and offline demo
// mode (CARTGUARD_MOCK_RAILS=1). Same interfaces as the real clients; the
// pipeline, gate, and audit code paths are the real ones.

export function createMockLlm(): ChatCompleter {
  let step = 0;
  return async (_request: { messages: LlmMessage[]; tools: LlmTool[] }): Promise<LlmReply> => {
    step += 1;
    if (step === 1) {
      return {
        content: "Searching the product graph for the best match…",
        toolCalls: [
          {
            id: "mock-1",
            name: "search_products",
            arguments: JSON.stringify({ query: "demo wireless earbuds", limit: 5 }),
          },
        ],
      };
    }
    if (step === 2) {
      return {
        content: null,
        toolCalls: [
          {
            id: "mock-2",
            name: "get_product",
            arguments: JSON.stringify({ product_id: DEMO_SEED_PRODUCTS[0]!.id }),
          },
        ],
      };
    }
    return {
      content: null,
      toolCalls: [
        {
          id: "mock-3",
          name: "propose_purchase",
          arguments: JSON.stringify({
            product_id: DEMO_SEED_PRODUCTS[0]!.id,
            stated_price: 1,
            rationale: "Cheapest in-stock match with strong reviews; verified via product data.",
            goal_match_score: 0.95,
          }),
        },
      ],
    };
  };
}

export function createMockChannel3(): Channel3Client {
  return {
    searchProducts: async () => ({ products: [...DEMO_SEED_PRODUCTS], nextPageToken: null }),
    getProduct: async (id: string) => DEMO_SEED_PRODUCTS.find((p) => p.id === id) ?? null,
  };
}

export function createMockPaypal(): PaypalOrders & { captures: string[] } {
  const captures: string[] = [];
  return {
    captures,
    createOrder: async (params) => {
      // A vault-token charge completes immediately, like the real rail.
      return {
        orderId: `MOCK-ORD-${captures.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
        status: params.vaultId !== undefined ? "COMPLETED" : "PAYER_ACTION_REQUIRED",
        approvalUrl: "https://www.sandbox.paypal.com/checkoutnow?token=MOCK-DEMO",
      };
    },
    captureOrder: async (orderId) => {
      captures.push(orderId);
      return { orderId, status: "COMPLETED" };
    },
    getVaultId: async () => "MOCK-VAULT-TOKEN-001",
  };
}
