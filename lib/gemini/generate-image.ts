// AI image generation for Module 3 posts, using Google's Gemini image
// models ("Nano Banana" family). Chosen over OpenAI's gpt-image-1 because
// Gemini's free tier is currently generous enough for this app's needs
// (Google AI Studio: up to 500 images/day at no cost, no card required —
// get a key at https://aistudio.google.com/apikey). Free-tier limits are
// Google's to change, so if this ever starts failing with a quota error,
// check current limits there.
//
// Plain fetch call (like lib/threads/publish.ts) rather than pulling in
// the @google/genai SDK, to match this codebase's existing lightweight
// style for external APIs.

export class ImageGenerationError extends Error {}

export interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
}

// Configurable in case Google's model lineup shifts again — see
// https://ai.google.dev/gemini-api/docs/image-generation for current names.
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

// Preview/experimental image models (this one included) return a transient
// "currently experiencing high demand" / 503 UNAVAILABLE error fairly often
// under real traffic — it's Google's servers being momentarily overloaded,
// not a quota or billing problem (that's the separate "quota exceeded"
// error, which is NOT retried here since retrying it would just fail again
// identically). A couple of short-backoff retries clears most of these
// without the user having to manually click Generate again.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;

function isTransientOverloadError(status: number, message: string): boolean {
  return status === 503 || status === 429 || /high demand|overloaded|unavailable/i.test(message);
}

export interface ReferenceImage {
  buffer: Buffer;
  mimeType: string;
}

/**
 * When referenceImage is given, Gemini does image-conditioned generation
 * (a real photo attached alongside the text instruction) instead of
 * imagining an image from the text prompt alone — used so a Shopee product
 * photo (see lib/shopee/fetch-product-image.ts) keeps its real appearance
 * (shape, color, label) while the model composes a fresh, more engaging
 * scene around it, rather than hallucinating an unrelated product from
 * scratch. Omit it for the original text-only behavior.
 */
export async function generateImage(prompt: string, referenceImage?: ReferenceImage): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ImageGenerationError(
      "GEMINI_API_KEY is not set. Get a free key at aistudio.google.com/apikey and add it to " +
        ".env.local (and Railway → Variables) to use AI image generation."
    );
  }

  let lastError: string = "Image generation request failed";

  const requestParts: Array<Record<string, unknown>> = [];
  if (referenceImage) {
    requestParts.push({
      inlineData: {
        mimeType: referenceImage.mimeType,
        data: referenceImage.buffer.toString("base64")
      }
    });
  }
  requestParts.push({ text: prompt });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [{ parts: requestParts }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
      })
    });

    const data = await res.json();

    if (!res.ok) {
      lastError = data?.error?.message || "Image generation request failed";
      if (attempt < MAX_ATTEMPTS && isTransientOverloadError(res.status, lastError)) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
        continue;
      }
      throw new ImageGenerationError(lastError);
    }

    const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> =
      data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);

    if (!imagePart?.inlineData?.data) {
      lastError = "Image generation returned no image data";
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
        continue;
      }
      throw new ImageGenerationError(lastError);
    }

    return {
      buffer: Buffer.from(imagePart.inlineData.data, "base64"),
      contentType: imagePart.inlineData.mimeType || "image/png"
    };
  }

  throw new ImageGenerationError(lastError);
}
