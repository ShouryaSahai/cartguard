import {
  Channel3ProductSchema,
  Channel3SearchResponseSchema,
  normalizeChannel3Product,
  type Channel3Product,
  type NormalizedProduct,
} from "@cartguard/shared";

const DEFAULT_BASE_URL = "https://api.trychannel3.com";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class Channel3Error extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "Channel3Error";
  }
}

export interface Channel3Client {
  searchProducts(
    query: string,
    limit?: number,
  ): Promise<{ products: NormalizedProduct[]; nextPageToken: string | null }>;
  getProduct(id: string): Promise<NormalizedProduct | null>;
}

export interface Channel3ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

export function createChannel3Client(options: Channel3ClientOptions = {}): Channel3Client {
  const apiKey = options.apiKey ?? process.env.CHANNEL3_API_KEY ?? "";
  if (apiKey === "") throw new Error("CHANNEL3_API_KEY is not set");
  const baseUrl = (
    options.baseUrl ??
    process.env.CHANNEL3_BASE_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await doFetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new Channel3Error(
        response.status,
        `Channel3 ${path} failed with HTTP ${response.status}`,
      );
    }
    return (await response.json()) as unknown;
  }

  async function searchProducts(
    query: string,
    limit = 10,
  ): Promise<{ products: NormalizedProduct[]; nextPageToken: string | null }> {
    const parsed = Channel3SearchResponseSchema.parse(
      await request("/v1/search", {
        method: "POST",
        body: JSON.stringify({ query, limit }),
      }),
    );
    return {
      products: parsed.products.map(normalizeChannel3Product),
      nextPageToken: parsed.next_page_token ?? null,
    };
  }

  async function getProduct(id: string): Promise<NormalizedProduct | null> {
    const raw: unknown = await request(`/v1/products/${encodeURIComponent(id)}`);
    const parsed = Channel3ProductSchema.safeParse(raw);
    if (!parsed.success) return null;
    const product: Channel3Product = parsed.data;
    return normalizeChannel3Product(product);
  }

  return { searchProducts, getProduct };
}
