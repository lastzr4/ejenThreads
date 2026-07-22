// UNUSED — kept only as a reference implementation.
//
// CopyCreator's Module 3 image generation now uses Google Gemini instead
// (see lib/gemini/generate-image.ts), because Gemini's free tier
// (~500 images/day at no cost, no card required — aistudio.google.com/apikey)
// comfortably covers this app's needs, whereas OpenAI's gpt-image-1 has no
// free tier at all. Nothing in the app imports this file anymore.
//
// If you'd rather use OpenAI (e.g. you already have billing set up there,
// or want gpt-image-1's quality/style for a specific case), this is a
// working implementation you can point lib/generation/generate-styled-post.ts
// back at — swap its `import { generateImage } from "@/lib/gemini/generate-image"`
// for `from "@/lib/openai/generate-image"` and set OPENAI_API_KEY instead
// of GEMINI_API_KEY. Same function signature either way.

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
