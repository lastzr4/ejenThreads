import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic/client";

// Shared by both the manual "Generate post" button
// (app/dashboard/creators/generate-actions.ts) and the Module 4 cron
// scheduler (app/api/cron/run-schedules) — same Claude call, same forced
// tool-use pattern as Module 2's Study feature, just reused from two
// different callers so the prompt/logic only lives in one place.

const GENERATE_TOOL = {
  name: "record_generated_post",
  description:
    "Record a new, original Threads post (or thread of sequential posts) written in a specific creator's studied style.",
  input_schema: {
    type: "object" as const,
    properties: {
      topic_used: {
        type: "string",
        description: "The topic/angle this post ended up being about, in a short phrase."
      },
      posts: {
        type: "array",
        items: { type: "string" },
        description:
          "One or more post texts. A single post is exactly one item. A thread is 2+ items, each " +
          "meant to be posted as sequential replies to itself — keep each item under ~450 characters."
      }
    },
    required: ["topic_used", "posts"]
  }
};

export interface GenerateStyledPostParams {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>;
  creatorId: string;
  topic?: string;
  postType: "single" | "thread";
}

export interface GenerateStyledPostResult {
  posts: string[];
  creatorUsername: string | null;
}

/**
 * Throws a plain Error with a user-facing message on any failure (no
 * analysis yet, Claude/API failure, empty result) — callers decide how to
 * surface/store that (redirect with ?error=, or write to
 * posting_schedules.last_error).
 */
export async function generateStyledPost({
  supabase,
  creatorId,
  topic,
  postType
}: GenerateStyledPostParams): Promise<GenerateStyledPostResult> {
  const { data: creator } = await supabase.from("creators").select("username").eq("id", creatorId).single();

  const { data: analysis } = await supabase
    .from("creator_analysis")
    .select(
      "style_tone, hook_patterns, threading_structure, emoji_usage, cta_patterns, vocabulary_notes, generated_rules"
    )
    .eq("creator_id", creatorId)
    .maybeSingle();

  if (!analysis) {
    throw new Error("Study this creator first — no style analysis found yet");
  }

  const { data: samplePosts } = await supabase
    .from("scraped_threads")
    .select("content_text, like_count")
    .eq("creator_id", creatorId)
    .not("content_text", "is", null)
    .order("like_count", { ascending: false })
    .limit(5);

  const anthropic = getAnthropicClient();

  const examplesBlock = (samplePosts ?? [])
    .filter((p) => p.content_text)
    .map((p, i) => `Example ${i + 1}: ${p.content_text}`)
    .join("\n\n");

  const userPrompt =
    `Write a brand-new, original Threads ${postType === "thread" ? "thread (multiple sequential posts)" : "post"} ` +
    `in the voice of @${creator?.username ?? "this creator"}, based on the style profile below.\n\n` +
    `STYLE PROFILE:\n` +
    `Tone: ${analysis.style_tone}\n` +
    `Hook patterns: ${JSON.stringify(analysis.hook_patterns)}\n` +
    `Threading structure: ${JSON.stringify(analysis.threading_structure)}\n` +
    `Emoji usage: ${JSON.stringify(analysis.emoji_usage)}\n` +
    `CTA patterns: ${JSON.stringify(analysis.cta_patterns)}\n` +
    `Vocabulary notes: ${analysis.vocabulary_notes}\n` +
    `Style guide: ${analysis.generated_rules}\n\n` +
    (examplesBlock ? `REAL EXAMPLES (for rhythm/length reference only — do not copy):\n${examplesBlock}\n\n` : "") +
    (topic
      ? `Topic to write about: ${topic}\n\n`
      : `No specific topic was given — pick one that fits this creator's usual themes based on the profile above.\n\n`) +
    `Call record_generated_post with the result.`;

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    system:
      "You are a ghostwriter producing brand-new social media posts that emulate a specific creator's " +
      "writing style. You are given a style profile derived from their real posts, and sometimes real " +
      "examples for rhythm/length reference. Never copy sentences or distinctive phrases verbatim from " +
      "the examples — write completely original content that only borrows the tone, structure, and " +
      "voice patterns described. Call the record_generated_post tool exactly once with your result.",
    messages: [{ role: "user", content: userPrompt }],
    tools: [GENERATE_TOOL],
    tool_choice: { type: "tool", name: "record_generated_post" }
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a generated post");
  }

  const result = toolUse.input as { topic_used?: string; posts?: string[] };
  const posts = Array.isArray(result.posts) ? result.posts.filter((p) => typeof p === "string" && p.trim()) : [];

  if (posts.length === 0) {
    throw new Error("Generated result was empty — try again");
  }

  return { posts, creatorUsername: creator?.username ?? null };
}
