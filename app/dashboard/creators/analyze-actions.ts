"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic/client";

// Forcing a single tool call is the reliable way to get structured JSON
// back from Claude, rather than asking it to format raw text as JSON and
// hoping it doesn't wrap it in prose or markdown fences.
const ANALYSIS_TOOL = {
  name: "record_creator_analysis",
  description: "Record a structured style analysis of a Threads creator's posts.",
  input_schema: {
    type: "object" as const,
    properties: {
      style_tone: {
        type: "string",
        description: "Overall tone/voice in a short phrase, e.g. 'witty, contrarian, high-energy'."
      },
      hook_patterns: {
        type: "string",
        description:
          "How this creator opens posts — patterns in the first line, with 1-2 concrete examples quoted from the posts."
      },
      threading_structure: {
        type: "string",
        description:
          "How they structure a longer thought across a post (setup/payoff, list format, single punchy statement, etc.)."
      },
      emoji_usage: {
        type: "string",
        description: "Frequency and style of emoji use, and which ones recur, if any."
      },
      cta_patterns: {
        type: "string",
        description: "Whether/how they end posts with a call to action, question, or engagement bait."
      },
      vocabulary_notes: {
        type: "string",
        description:
          "Notable word choices, slang, language mixing (e.g. Malay/English), recurring phrases."
      },
      generated_rules: {
        type: "string",
        description:
          "A condensed style guide (5-10 short directives) usable as a system prompt to generate new posts in this creator's voice."
      }
    },
    required: [
      "style_tone",
      "hook_patterns",
      "threading_structure",
      "emoji_usage",
      "cta_patterns",
      "vocabulary_notes",
      "generated_rules"
    ]
  }
};

export async function studyCreator(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();

  const { data: creator } = await supabase.from("creators").select("username").eq("id", id).single();

  const { data: posts } = await supabase
    .from("scraped_threads")
    .select("content_text, like_count, reply_count, repost_count, is_reply, published_at")
    .eq("creator_id", id)
    .order("published_at", { ascending: false });

  const usablePosts = (posts ?? []).filter(
    (p) => p.content_text && p.content_text.trim().length > 0
  );

  if (usablePosts.length === 0) {
    redirect(
      `/dashboard/creators/${id}?error=${encodeURIComponent(
        "No scraped posts with text yet — fetch posts first"
      )}`
    );
  }

  let errorMessage: string | null = null;

  try {
    const anthropic = getAnthropicClient();

    const postsBlock = usablePosts
      .map(
        (p, i) =>
          `Post ${i + 1}${p.is_reply ? " (reply)" : ""}:\n${p.content_text}\n` +
          `(likes: ${p.like_count}, replies: ${p.reply_count}, reposts: ${p.repost_count})`
      )
      .join("\n\n");

    const response = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system:
        "You analyze a social media creator's writing style from a sample of their posts. " +
        "Be specific and quote real phrases from the posts where useful. Call the " +
        "record_creator_analysis tool exactly once with your findings.",
      messages: [
        {
          role: "user",
          content:
            `Here are ${usablePosts.length} recent posts from Threads creator @${creator?.username ?? "unknown"}:\n\n` +
            `${postsBlock}\n\nAnalyze their style and call record_creator_analysis.`
        }
      ],
      tools: [ANALYSIS_TOOL],
      tool_choice: { type: "tool", name: "record_creator_analysis" }
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error("Claude did not return a structured analysis");
    }

    const analysis = toolUse.input as Record<string, string>;

    const { error: upsertError } = await supabase.from("creator_analysis").upsert(
      {
        creator_id: id,
        style_tone: analysis.style_tone,
        hook_patterns: analysis.hook_patterns,
        threading_structure: analysis.threading_structure,
        emoji_usage: analysis.emoji_usage,
        cta_patterns: analysis.cta_patterns,
        vocabulary_notes: analysis.vocabulary_notes,
        generated_rules: analysis.generated_rules,
        sample_size: usablePosts.length,
        model_used: ANTHROPIC_MODEL
      },
      { onConflict: "creator_id" }
    );

    if (upsertError) {
      errorMessage = upsertError.message;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Style analysis failed";
  }

  revalidatePath(`/dashboard/creators/${id}`);
  redirect(
    errorMessage
      ? `/dashboard/creators/${id}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/creators/${id}?message=${encodeURIComponent("Style analysis complete")}`
  );
}
