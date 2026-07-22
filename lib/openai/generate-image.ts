// AI image generation for Module 3 posts, using OpenAI's gpt-image-1.
// Kept as a plain fetch call (like lib/threads/publish.ts) rather than
// pulling in the openai npm package, to match this codebase's existing
// lightweight-fetch style for external APIs.
//
// gpt-image-1 always returns base64-encoded image bytes (no url option,
// unlike dall-e-2/3) — which actually suits us better here: we upload the
// bytes straight to Supabase Storage ourselves (lib/storage/upload-image.ts)
// rather than depending on a temporary OpenAI-hosted URL that expires
// before the Threads API gets a chance to fetch it.

export class ImageGenerationError extends Error {}

export interface GeneratedImage {
  buffer: Buffer;
  contentType: string;
}

export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ImageGenerationError(
      "OPENAI_API_KEY is not set. Add it to .env.local (and Railway → Variables) to use AI image generation."
    );
  }

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "medium",
      n: 1,
      output_format: "jpeg"
    })
  });

  const data = await res.json();

  if (!res.ok) {
    throw new ImageGenerationError(data?.error?.message || "Image generation request failed");
  }

  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) {
    throw new ImageGenerationError("Image generation returned no image data");
  }

  return { buffer: Buffer.from(b64, "base64"), contentType: "image/jpeg" };
}
