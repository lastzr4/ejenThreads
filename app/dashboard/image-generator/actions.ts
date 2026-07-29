"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { generateImage } from "@/lib/gemini/generate-image";
import { uploadGeneratedImage } from "@/lib/storage/upload-image";

/**
 * Standalone image generation — no post/creator/style involved, just a raw
 * prompt (optionally started from one of lib/image-templates.ts's presets)
 * straight to Gemini. Supports the same reference-photo mode Generate post
 * uses (lib/generation/generate-styled-post.ts): upload a real product
 * photo alongside the prompt and Gemini keeps its real appearance accurate
 * while building the scene the prompt describes, instead of imagining the
 * product from scratch.
 *
 * No history/gallery table — the most recent result is passed back via a
 * redirect query param and shown on the page; the underlying Supabase
 * Storage URL is permanent, so a generated image is never actually lost,
 * just not listed anywhere after leaving the page.
 */
export async function generateStandaloneImage(formData: FormData) {
  const prompt = String(formData.get("prompt") ?? "").trim();
  const referenceFiles = formData
    .getAll("referenceImages")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const hasReference = referenceFiles.length > 0;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!prompt) {
    redirect(`/dashboard/image-generator?error=${encodeURIComponent("Tulis prompt dulu")}`);
  }

  let imageUrl: string | null = null;
  let errorMessage: string | null = null;

  try {
    const referenceImages = hasReference
      ? await Promise.all(
          referenceFiles.map(async (file) => ({
            buffer: Buffer.from(await file.arrayBuffer()),
            mimeType: file.type || "image/jpeg"
          }))
        )
      : undefined;

    const finalPrompt = referenceImages
      ? `Using the exact product/item shown in the attached reference photo${referenceImages.length > 1 ? "s" : ""}, ` +
        `keep its real appearance (shape, color, material, label) accurate and unchanged. Build the following ` +
        `scene around it: ${prompt}`
      : prompt;

    const { buffer, contentType } = await generateImage(finalPrompt, referenceImages);
    imageUrl = await uploadGeneratedImage(buffer, contentType);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Image generation failed";
  }

  revalidatePath("/dashboard/image-generator");
  redirect(
    errorMessage
      ? `/dashboard/image-generator?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/image-generator?imageUrl=${encodeURIComponent(imageUrl as string)}`
  );
}
