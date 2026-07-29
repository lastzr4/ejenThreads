import { chromium } from "playwright";

// Real-product-photo lookup for affiliate posts. Problem this solves: when a
// Shopee link is dropped in the Generate-post Topic field, Claude has no way
// to know what the actual product looks like (it can't open the link) — the
// AI-imagined image it used to describe from scratch was frequently
// unrelated to the real item. This fetches the ACTUAL product photo instead,
// which then gets passed to Gemini as a reference image (see
// lib/gemini/generate-image.ts's referenceImage param) so the generated
// image keeps the real product's appearance while still composing a fresh,
// engagement-optimized scene around it.
//
// CAVEAT (be upfront about this): the selector/meta-tag strategy below could
// not be empirically confirmed against a live Shopee render — this sandbox's
// outbound network blocks downloading a Chromium binary, so Playwright
// couldn't actually be run here to verify. This follows the same "confirmed
// against a live page" methodology lib/threads/scraper.ts's DOM extractor
// used, just without the live-verification step completed yet. If this
// comes back empty/wrong after a real run on Railway (which does have a
// working headless Chromium — see /Dockerfile), check server logs for the
// `[fetchShopeeProductInfo]` messages below and adjust the selectors — same
// one-iteration refinement the Threads scraper needed originally.

export interface ShopeeProductInfo {
  imageBuffer: Buffer;
  imageMimeType: string;
  title: string | null;
}

const SHOPEE_URL_RE = /https?:\/\/(?:[\w-]+\.)?shopee\.(?:com\.my|com|sg|co\.id|co\.th|vn|ph|tw)[^\s]*/i;

/** True if the given text contains a Shopee link anywhere in it. */
export function containsShopeeLink(text: string | null | undefined): boolean {
  return Boolean(text && SHOPEE_URL_RE.test(text));
}

/** Pulls the first Shopee URL out of a longer text block (e.g. the Topic field). */
export function extractShopeeUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(SHOPEE_URL_RE);
  return match ? match[0] : null;
}

/**
 * Opens a Shopee product link in headless Chromium and pulls out the real
 * product photo + title. Returns null on ANY failure (short link didn't
 * resolve, page structure changed, no image found, download failed) — this
 * is always a soft fallback, never fatal to post generation; the caller
 * falls back to the old AI-imagined-image behavior.
 */
export async function fetchShopeeProductInfo(url: string): Promise<ShopeeProductInfo | null> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    // Give client-side rendering/hydration a moment to finish injecting
    // meta tags and lazy-loading the main product image.
    await page.waitForTimeout(2000);

    const extracted = await page.evaluate(() => {
      const og = (name: string) =>
        document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ?? null;

      const ogImage = og("og:image");
      const ogTitle = og("og:title") || document.title || null;
      if (ogImage) return { imageUrl: ogImage, title: ogTitle };

      // Fallback: no OG tags present in this render — pick the largest
      // visible <img> on the page as a best guess at the main product
      // photo, excluding tiny icons/logos.
      const images = Array.from(document.querySelectorAll("img"))
        .filter((img) => img.naturalWidth > 200 && img.naturalHeight > 200)
        .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);

      return images[0] ? { imageUrl: images[0].src, title: ogTitle } : null;
    });

    await browser.close();
    browser = undefined;

    if (!extracted?.imageUrl) {
      console.error("[fetchShopeeProductInfo] no product image found on page:", url);
      return null;
    }

    const imageRes = await fetch(extracted.imageUrl);
    if (!imageRes.ok) {
      console.error("[fetchShopeeProductInfo] failed to download product image:", extracted.imageUrl, imageRes.status);
      return null;
    }
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    const mimeType = imageRes.headers.get("content-type") || "image/jpeg";

    return { imageBuffer: buffer, imageMimeType: mimeType, title: extracted.title };
  } catch (err) {
    console.error("[fetchShopeeProductInfo] failed:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
