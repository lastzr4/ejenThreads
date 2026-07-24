"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import pdfParse from "pdf-parse";
import { createClient } from "@/lib/supabase/server";
import { extractWebpageText } from "@/lib/knowledge/extract-webpage-text";

// Roughly ~40,000 characters is already far more than any single Claude
// prompt needs as reference material (see how this gets used in
// lib/generation/generate-styled-post.ts) — cap it so a huge PDF doesn't
// blow out the prompt or the database row. Truncating (rather than
// rejecting) still gives the AI most of the document to draw from.
const MAX_KNOWLEDGE_CHARS = 40000;

/**
 * Per-creator "knowledge base": upload one PDF, extract its text, store it
 * on creators.knowledge_base_text. Re-uploading replaces the previous
 * document — this is a single reference doc per creator, not a library.
 * Wired into generation in lib/generation/generate-styled-post.ts, which
 * folds this text into the prompt as background material for posts to
 * reference/revolve around.
 */
export async function uploadKnowledgeBase(formData: FormData) {
  const creatorId = String(formData.get("creatorId") ?? "");
  const file = formData.get("knowledgeFile");
  if (!creatorId) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/dashboard/creators/${creatorId}?error=${encodeURIComponent("Pick a PDF file to upload")}`);
  }

  const pdfFile = file as File;
  if (pdfFile.type && pdfFile.type !== "application/pdf" && !pdfFile.name.toLowerCase().endsWith(".pdf")) {
    redirect(
      `/dashboard/creators/${creatorId}?error=${encodeURIComponent("Only PDF files are supported for now")}`
    );
  }

  let errorMessage: string | null = null;

  try {
    const buffer = Buffer.from(await pdfFile.arrayBuffer());
    const parsed = await pdfParse(buffer);
    const text = parsed.text.trim();

    if (!text) {
      throw new Error("Couldn't extract any text from that PDF — it may be scanned images without OCR text");
    }

    const truncated = text.length > MAX_KNOWLEDGE_CHARS ? text.slice(0, MAX_KNOWLEDGE_CHARS) : text;

    const { error: updateError } = await supabase
      .from("creators")
      .update({
        knowledge_base_text: truncated,
        knowledge_base_filename: pdfFile.name,
        knowledge_base_updated_at: new Date().toISOString()
      })
      .eq("id", creatorId);

    if (updateError) {
      errorMessage = updateError.message;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to read PDF";
  }

  revalidatePath(`/dashboard/creators/${creatorId}`);
  redirect(
    errorMessage
      ? `/dashboard/creators/${creatorId}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/creators/${creatorId}?message=${encodeURIComponent("Knowledge base updated")}`
  );
}

/**
 * Alternative to uploadKnowledgeBase — paste a webpage URL instead of a
 * PDF file. Fetches the page server-side, extracts its readable text
 * (lib/knowledge/extract-webpage-text.ts), and stores it the same way a
 * PDF would be: same creators.knowledge_base_text column, same 40,000-
 * character cap, same "replaces whatever was there before" behavior. Either
 * source feeds the exact same downstream generation logic — the creator's
 * knowledge base doesn't track or care which way its current text arrived.
 */
export async function addKnowledgeBaseFromUrl(formData: FormData) {
  const creatorId = String(formData.get("creatorId") ?? "");
  const url = String(formData.get("knowledgeUrl") ?? "").trim();
  if (!creatorId) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!url) {
    redirect(`/dashboard/creators/${creatorId}?error=${encodeURIComponent("Paste a URL to fetch")}`);
  }

  let errorMessage: string | null = null;

  try {
    const { title, text } = await extractWebpageText(url);
    const truncated = text.length > MAX_KNOWLEDGE_CHARS ? text.slice(0, MAX_KNOWLEDGE_CHARS) : text;

    const { error: updateError } = await supabase
      .from("creators")
      .update({
        knowledge_base_text: truncated,
        knowledge_base_filename: title ? `${title} (${url})` : url,
        knowledge_base_updated_at: new Date().toISOString()
      })
      .eq("id", creatorId);

    if (updateError) {
      errorMessage = updateError.message;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to read that URL";
  }

  revalidatePath(`/dashboard/creators/${creatorId}`);
  redirect(
    errorMessage
      ? `/dashboard/creators/${creatorId}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/creators/${creatorId}?message=${encodeURIComponent("Knowledge base updated from URL")}`
  );
}

export async function clearKnowledgeBase(formData: FormData) {
  const creatorId = String(formData.get("creatorId") ?? "");
  if (!creatorId) return;

  const supabase = createClient();
  const { error } = await supabase
    .from("creators")
    .update({
      knowledge_base_text: null,
      knowledge_base_filename: null,
      knowledge_base_updated_at: null
    })
    .eq("id", creatorId);

  if (error) {
    redirect(`/dashboard/creators/${creatorId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath(`/dashboard/creators/${creatorId}`);
  redirect(`/dashboard/creators/${creatorId}?message=${encodeURIComponent("Knowledge base removed")}`);
}
