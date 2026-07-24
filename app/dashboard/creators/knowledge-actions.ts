"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import pdfParse from "pdf-parse";
import { createClient } from "@/lib/supabase/server";
import { extractWebpageText } from "@/lib/knowledge/extract-webpage-text";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { SupabaseClient } from "@supabase/supabase-js";

// Roughly ~40,000 characters is already far more than any single Claude
// prompt needs as reference material (see how this gets used in
// lib/generation/generate-styled-post.ts) — cap the combined total so a
// long history of added sources doesn't blow out the prompt or the
// database row.
const MAX_KNOWLEDGE_CHARS = 40000;

/**
 * Per-creator "knowledge base": upload PDFs and/or paste URLs, one at a
 * time — each addition is appended below whatever's already there (not
 * replaced), so the knowledge base keeps growing as more sources are added.
 * Wired into generation in lib/generation/generate-styled-post.ts, which
 * folds the whole accumulated text into the prompt as background material.
 *
 * If the combined text would exceed MAX_KNOWLEDGE_CHARS, the OLDEST
 * sections are trimmed from the front first — the newest addition (what
 * the user just added) always survives intact; older history is what gets
 * squeezed out once the cap is hit.
 */
async function appendKnowledgeSource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  creatorId: string,
  sourceLabel: string,
  newText: string
): Promise<{ error: string | null }> {
  const { data: existing } = await supabase
    .from("creators")
    .select("knowledge_base_text, knowledge_base_filename")
    .eq("id", creatorId)
    .maybeSingle();

  const existingText = (existing?.knowledge_base_text as string | null) ?? "";
  const existingLabel = (existing?.knowledge_base_filename as string | null) ?? "";

  const addedAt = new Date().toISOString().slice(0, 10);
  const newSection = `=== Source: ${sourceLabel} (added ${addedAt}) ===\n\n${newText.trim()}`;
  let combinedText = existingText ? `${existingText}\n\n${newSection}` : newSection;

  // Trim from the front (oldest sections first) if over the cap — keeps
  // whatever was just added intact rather than truncating it away.
  if (combinedText.length > MAX_KNOWLEDGE_CHARS) {
    combinedText = combinedText.slice(combinedText.length - MAX_KNOWLEDGE_CHARS);
    // Avoid starting mid-sentence in a chopped-off section — cut back to
    // the next section boundary if one exists nearby.
    const boundary = combinedText.indexOf("=== Source:");
    if (boundary > 0 && boundary < 2000) {
      combinedText = combinedText.slice(boundary);
    }
  }

  const combinedLabel = existingLabel ? `${existingLabel} • ${sourceLabel}` : sourceLabel;

  const { error } = await supabase
    .from("creators")
    .update({
      knowledge_base_text: combinedText,
      knowledge_base_filename: combinedLabel,
      knowledge_base_updated_at: new Date().toISOString()
    })
    .eq("id", creatorId);

  return { error: error?.message ?? null };
}

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

    const { error } = await appendKnowledgeSource(supabase, creatorId, pdfFile.name, text);
    if (error) errorMessage = error;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to read PDF";
  }

  revalidatePath(`/dashboard/creators/${creatorId}`);
  redirect(
    errorMessage
      ? `/dashboard/creators/${creatorId}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/creators/${creatorId}?message=${encodeURIComponent("Added to knowledge base")}`
  );
}

/**
 * Alternative to uploadKnowledgeBase — paste a webpage URL instead of a
 * PDF file. Fetches the page server-side, extracts its readable text
 * (lib/knowledge/extract-webpage-text.ts), and appends it the same way a
 * PDF would be (see appendKnowledgeSource) — nothing gets stored except
 * the extracted plain text, never the page/file itself.
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
    const label = title ? `${title} (${url})` : url;
    const { error } = await appendKnowledgeSource(supabase, creatorId, label, text);
    if (error) errorMessage = error;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Failed to read that URL";
  }

  revalidatePath(`/dashboard/creators/${creatorId}`);
  redirect(
    errorMessage
      ? `/dashboard/creators/${creatorId}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/creators/${creatorId}?message=${encodeURIComponent("Added to knowledge base")}`
  );
}

/**
 * Wipes the whole accumulated knowledge base for this creator — the only
 * way to remove a specific source is to clear everything and re-add the
 * ones you want to keep (there's no per-source delete, since the text is
 * just one combined blob, not tracked as separate records).
 */
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
  redirect(`/dashboard/creators/${creatorId}?message=${encodeURIComponent("Knowledge base cleared")}`);
}
