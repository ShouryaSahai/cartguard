import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Channel3Error, createChannel3Client, type FetchLike } from "../src/channel3.js";
import type { NormalizedProduct } from "@cartguard/shared";

const FIXTURE: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/search-earbuds.json", import.meta.url), "utf8"),
);

function fetchJson(body: unknown, status = 200): FetchLike {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("channel3 client: search", () => {
  it("normalizes a real captured search response (live fixture)", async () => {
    const client = createChannel3Client({ apiKey: "k", fetchImpl: fetchJson(FIXTURE) });
    const { products } = await client.searchProducts("wireless earbuds");
    expect(products.length).toBeGreaterThanOrEqual(1);
    const first: NormalizedProduct = products[0]!;
    expect(first.id.length).toBeGreaterThan(0);
    expect(first.title.length).toBeGreaterThan(0);
    expect(first.bestOffer).not.toBeNull();
    expect(first.bestOffer!.currency).toBe("USD");
    expect(first.bestOffer!.inStock).toBe(true);
    expect(first.offers.every((o) => typeof o.price === "number")).toBe(true);
  });

  it("sends the api key as the x-api-key header", async () => {
    let captured: RequestInit | undefined;
    const fetchImpl: FetchLike = async (_input, init) => {
      captured = init;
      return fetchJson(FIXTURE)("https://api.trychannel3.com/v1/search");
    };
    const client = createChannel3Client({ apiKey: "secret-key", fetchImpl });
    await client.searchProducts("earbuds");
    expect(captured?.headers).toMatchObject({ "x-api-key": "secret-key" });
  });

  it("throws a Channel3Error on non-2xx responses", async () => {
    const client = createChannel3Client({ apiKey: "k", fetchImpl: fetchJson({ error: "nope" }, 401) });
    await expect(client.searchProducts("earbuds")).rejects.toBeInstanceOf(Channel3Error);
  });

  it("throws when no api key is available", () => {
    expect(() => createChannel3Client({ apiKey: "" })).toThrow(/CHANNEL3_API_KEY/);
  });
});

describe("channel3 client: product detail (the gate's re-verification path)", () => {
  it("fetches and normalizes a single product by id", async () => {
    const raw = (FIXTURE as { products: unknown[] }).products[0];
    const client = createChannel3Client({ apiKey: "k", fetchImpl: fetchJson(raw) });
    const product = await client.getProduct("lq5LOsn");
    expect(product).not.toBeNull();
    expect(product!.id).toBe("lq5LOsn");
  });

  it("returns null (not a throw) for a malformed product body", async () => {
    const client = createChannel3Client({ apiKey: "k", fetchImpl: fetchJson({ unexpected: true }) });
    const product = await client.getProduct("x1");
    expect(product).toBeNull();
  });
});

describe("channel3 client: offer selection", () => {
  it("prefers in-stock USD offers over cheaper non-USD offers", async () => {
    const raw = {
      id: "x1",
      title: "Mixed currency product",
      offers: [
        { domain: "de-shop.de", price: { price: 10, currency: "EUR" }, availability: "InStock" },
        { domain: "us-shop.com", price: { price: 25, currency: "USD" }, availability: "InStock" },
      ],
    };
    const client = createChannel3Client({ apiKey: "k", fetchImpl: fetchJson(raw) });
    const product = await client.getProduct("x1");
    expect(product!.bestOffer!.domain).toBe("us-shop.com");
  });

  it("falls back to the cheapest USD offer even when out of stock (policy blocks later)", async () => {
    const raw = {
      id: "x2",
      title: "Out of stock product",
      offers: [
        { domain: "a.com", price: { price: 30, currency: "USD" }, availability: "OutOfStock" },
        { domain: "b.com", price: { price: 40, currency: "USD" }, availability: "OutOfStock" },
      ],
    };
    const client = createChannel3Client({ apiKey: "k", fetchImpl: fetchJson(raw) });
    const product = await client.getProduct("x2");
    expect(product!.bestOffer!.domain).toBe("a.com");
    expect(product!.bestOffer!.inStock).toBe(false);
  });
});
