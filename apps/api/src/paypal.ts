import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaypalPaymentTokenUsageType,
  StoreInVaultInstruction,
} from "@paypal/paypal-server-sdk";

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

export function assertSandboxBaseUrl(baseUrl: string | undefined): void {
  if (baseUrl !== undefined && baseUrl !== SANDBOX_BASE_URL) {
    throw new Error(
      `Refusing non-sandbox PayPal base URL: ${baseUrl}. CartGuard only talks to ${SANDBOX_BASE_URL}.`,
    );
  }
}

export interface CreateOrderParams {
  amountUsd: number;
  returnUrl: string;
  cancelUrl: string;
  brandName: string;
  /** Vault the buyer's PayPal on success so later auto-charge can use the token. */
  vaultOnSuccess: boolean;
}

export interface PaypalOrderResult {
  orderId: string;
  status: string;
  approvalUrl: string | null;
}

export interface PaypalOrders {
  createOrder(params: CreateOrderParams): Promise<PaypalOrderResult>;
  captureOrder(orderId: string): Promise<{ orderId: string; status: string }>;
}

export function createPaypalOrdersFromEnv(env: NodeJS.ProcessEnv = process.env): PaypalOrders {
  assertSandboxBaseUrl(env.PAYPAL_API_BASE);
  const clientId = env.PAYPAL_CLIENT_ID ?? "";
  const clientSecret = env.PAYPAL_CLIENT_SECRET ?? "";
  if (clientId === "" || clientSecret === "") {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  }
  const client = new Client({
    environment: Environment.Sandbox,
    clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
  });
  const orders = new OrdersController(client);

  return {
    async createOrder(params: CreateOrderParams): Promise<PaypalOrderResult> {
      const response = await orders.createOrder({
        body: {
          intent: CheckoutPaymentIntent.Capture,
          purchaseUnits: [
            { amount: { currencyCode: "USD", value: params.amountUsd.toFixed(2) } },
          ],
          paymentSource: {
            paypal: {
              experienceContext: {
                brandName: params.brandName,
                returnUrl: params.returnUrl,
                cancelUrl: params.cancelUrl,
              },
              ...(params.vaultOnSuccess
                ? {
                    attributes: {
                      vault: {
                        storeInVault: StoreInVaultInstruction.OnSuccess,
                        usageType: PaypalPaymentTokenUsageType.Merchant,
                      },
                    },
                  }
                : {}),
            },
          },
        },
      });
      const order = response.result;
      const approvalUrl =
        order.links?.find((link: { rel?: string; href: string }) => link.rel === "payer-action" || link.rel === "approve")?.href ??
        null;
      return { orderId: order.id ?? "", status: order.status ?? "UNKNOWN", approvalUrl };
    },

    async captureOrder(orderId: string): Promise<{ orderId: string; status: string }> {
      const response = await orders.captureOrder({ id: orderId });
      return { orderId, status: response.result.status ?? "UNKNOWN" };
    },
  };
}
