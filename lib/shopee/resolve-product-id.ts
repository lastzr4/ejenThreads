// Turns any Shopee link (short link, full link, with/without tracking
// params) into a stable identifier for the SAME product, so the product
// photo library (shopee_product_photos — see lib/shopee/product-photo-
// library.ts) can recognize "this is the same item I saved a photo for
// before" even when the user pastes a differently-shaped link to it next
// time.
//
// Only follows HTTP redirects via a plain fetch — no browser/JS rendering
// involved, unlike lib/shopee/fetch-product-image.ts. This matters: testing
// confirmed Shopee's anti-bot system blocks the full JS-rendered page load
// (redirecting it to a challenge page), but a plain redirect-following
// fetch to resolve a short link to its canonical URL works fine — the two
// are handled by different layers of Shopee's infrastructure. So this stays
// reliable even on days the full scrape in fetch-product-image.ts doesn't.

export interface ResolvedShopeeProduct {
  productId: string;
  canonicalUrl: string;
}

/**
 * Resolves a Shopee link (following redirects, e.g. an s.shopee.com.my
 * short link) and extracts a stable product id from its canonical path —
 * Shopee product URLs encode two numbers (shop id + item id, in either
 * order depending on the URL shape) which together uniquely identify one
 * product regardless of which link format was pasted. Returns null if the
 * link doesn't resolve or doesn't look like a product URL.
 */
export async function resolveShopeeProductId(url: string): Promise<ResolvedShopeeProduct | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
      }
    });
    const finalUrl = res.url || url;
    const path = new URL(finalUrl).pathname;
    const nums = Array.from(path.matchAll(/(\d{5,})/g)).map((m) => m[1]);

    if (nums.length < 2) {
      console.error("[resolveShopeeProductId] couldn't find two id numbers in resolved path:", finalUrl);
      return null;
    }

    return { productId: nums.slice(0, 2).join(":"), canonicalUrl: finalUrl };
  } catch (err) {
    console.error("[resolveShopeeProductId] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
