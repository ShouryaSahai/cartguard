import type { NormalizedProduct } from "@cartguard/shared";

// Demo dataset used by scripts/seed-demo.ts (dashboard seeding) and by the
// mock rails for end-to-end tests. Offline and clearly fictional.

function offer(domain: string, price: number, currency = "USD"): NormalizedProduct["offers"][number] {
  return {
    url: `https://${domain}/p/cartguard-demo`,
    domain,
    price,
    compareAtPrice: null,
    currency,
    availability: "InStock",
    inStock: true,
  };
}

export const DEMO_SEED_PRODUCTS: NormalizedProduct[] = [
  {
    id: "demo-earbuds-1",
    title: "CartGuard Demo Earbuds",
    description: "Offline demo product with verified USD pricing.",
    brand: "Acme",
    categorySlug: "in-ear-headphones",
    image: null,
    rating: 4.8,
    offers: [offer("bestbuy.com", 21.99)],
    bestOffer: offer("bestbuy.com", 21.99),
  },
  {
    id: "demo-laptop-1",
    title: "Demo Ultrabook 14",
    description: "Offline demo product for approval-flow demos.",
    brand: "Lenovo",
    categorySlug: "laptops",
    image: null,
    rating: 4.3,
    offers: [offer("walmart.com", 389)],
    bestOffer: offer("walmart.com", 389),
  },
  {
    id: "demo-bait-1",
    title: "Too-Good-To-Be-True Headphones",
    description: "Suspiciously cheap demo product for the blocked path.",
    brand: "NoName",
    categorySlug: "headphones",
    image: null,
    rating: null,
    offers: [offer("sketchy-shop.example", 18.5)],
    bestOffer: offer("sketchy-shop.example", 18.5),
  },
];
