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

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ImageGenerationError(
      "GEMINI_API_KEY is not set. Get a free key at aistudio.google.com/apikey and add it to " +
        ".env.local (and Railway → Variables) to use AI image generation."
    );
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ImageGenerationError(data?.error?.message || "Image generation request failed");
  }

  const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  const imagePart = parts.find((p) => p.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    throw new ImageGenerationError("Image generation returned no image data");
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, "base64"),
    contentType: imagePart.inlineData.mimeType || "image/png"
  };
}
