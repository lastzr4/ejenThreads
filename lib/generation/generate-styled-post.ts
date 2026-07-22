import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic/client";
import { nicheLabel } from "@/lib/niches";
import { generateImage } from "@/lib/gemini/generate-image";
import { uploadGeneratedImage } from "@/lib/storage/upload-image";

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
          "meant to be posted as sequential replies to itself — keep each item under ~450 characters. " +
          "Exception: if text_attachment is being used (see below), the single item here should be a " +
          "short teaser/opening line instead, not the full content."
      },
      text_attachment: {
        type: "string",
        description:
          "Rarely needed — prefer splitting long content into multiple sequential reply posts instead " +
          "(see the 'posts' field guidance above), which reads as a normal comment continuation. Only use " +
          "this instead for a single post with no reply continuation, where you specifically want Threads' " +
          "expandable long-form 'See more' text attached to just that one post. Omit entirely otherwise."
      },
      image_prompt: {
        type: "string",
        description:
          "Only include this if an accompanying image was requested (see instructions). A vivid, " +
          "concrete English description for an image generator — describe a real photo-style scene " +
          "(product shot, lifestyle photo, etc.) that fits the post. Omit entirely if no image was requested."
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
  niche?: string | null;
  generateImage?: boolean;
  /**
   * Free-text persona/format instruction, e.g. "This account is a
   * professional writer who publishes short creative fiction (cerpen),
   * ending with an affiliate product plug." Unlike niche (a topic
   * category) or topic (a specific subject), this overrides the *shape*
   * of the post itself — narrative structure, format, framing device —
   * while the studied creator's tone/voice profile still guides the
   * actual wording. Optional; when omitted, generation behaves exactly
   * as before (style profile + niche + topic only).
   */
  role?: string | null;
}

export interface GenerateStyledPostResult {
  posts: string[];
  creatorUsername: string | null;
  imageUrl: string | null;
  /**
   * Long-form body text for a single post that doesn't fit Threads' ~500-
   * character limit (e.g. a full cerpen/short story) — Threads shows this
   * as expandable "See more" text on that one post, while `posts[0]` is
   * just the short teaser. Null unless the format was "single" and the
   * content genuinely needed it.
   */
  textAttachment: string | null;
}

/**
 * Throws a plain Error with a user-facing message on any failure (no
 * analysis yet, Claude/API failure, empty result) — callers decide how to
 * surface/store that (redirect with ?error=, or write to
 * posting_schedules.last_error).
 *
 * Image generation failures are NOT fatal to the whole call — if the text
 * generates fine but the image step fails (missing OPENAI_API_KEY, API
 * error, etc.), this still returns the posts with imageUrl: null rather
 * than losing a perfectly good piece of text over an image problem.
 */
export async function generateStyledPost({
  supabase,
  creatorId,
  topic,
  postType,
  niche,
  role,
  generateImage: wantsImage = false
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

  const nicheDescription = nicheLabel(niche);
  const isAffiliateNiche = niche === "affiliate_product";
  const hasRole = Boolean(role && role.trim());
  // A custom Role overrides the generic affiliate hook-line format below —
  // a role like "professional cerpen writer" defines its own narrative
  // shape, so forcing the punchy-hook-then-tag-lines template on top of it
  // would fight the role instead of following it. The product-tag format
  // (🏷️<name> : <link>) still gets requested separately when links are
  // present, since that's the affiliate-tracking mechanism itself, not a
  // stylistic choice.
  const wantsAffiliateHookFormat =
    !hasRole && (isAffiliateNiche || /https?:\/\/|\.com|\.my|shopee|tiktok/i.test(topic ?? ""));
  const hasLinksToTag = isAffiliateNiche || /https?:\/\/|\.com|\.my|shopee|tiktok/i.test(topic ?? "");

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
    (hasRole
      ? `ROLE / FORMAT INSTRUCTIONS (these take priority over generic formatting — follow them for the ` +
        `overall shape, narrative structure, and framing of this post; still write in the creator's tone/ ` +
        `voice from the style profile above):\n${role!.trim()}\n\n` +
        (postType === "thread"
          ? `Use as many sequential posts as the story/format genuinely needs — not limited to 2-3 if a ` +
            `fuller narrative arc calls for more.\n\n`
          : `Prefer a SINGLE post if the content comfortably fits under ~450 characters — just write the ` +
            `whole thing in "posts" as one item. But if this role/format genuinely needs more room (e.g. a ` +
            `full short story), do NOT cram it into one post or cut it short. Instead write it as a natural ` +
            `sequence: the first post stands alone, and each following part continues as a reply/comment on ` +
            `the previous one (same mechanism as a thread) — return each part as its own item in "posts", ` +
            `each under ~450 characters, in reading order. The reader experiences it as one continuous post ` +
            `followed by its own comment thread, so keep each part self-contained enough to read naturally ` +
            `as a continuation rather than a jarring cut.\n\n`)
      : "") +
    (nicheDescription ? `Niche/category to write within: ${nicheDescription}\n\n` : "") +
    (topic
      ? `Topic to write about: ${topic}\n\n`
      : `No specific topic was given — pick one that fits this creator's usual themes` +
        (nicheDescription ? ` and the niche above` : "") +
        `.\n\n`) +
    (wantsAffiliateHookFormat
      ? `AFFILIATE POST FORMAT: open with a short, punchy, emotionally relatable hook (1-2 sentences) — ` +
        `Malaysian social-media style often uses an ironic "plot twist" framing (expecting something bad, ` +
        `pleasantly surprised, or vice versa), ending with an emotive emoji if it fits the creator's style. ` +
        `Then, on separate lines, tag every product/link exactly as given in the topic above using the format ` +
        `"🏷️<Product name> : <link>" — one line per product. Never invent, shorten, or alter a link; only ` +
        `reproduce links that were actually given in the topic text.\n\n`
      : hasRole && hasLinksToTag
        ? `Somewhere that fits the role/format above (e.g. near the end, as a natural pivot to a ` +
          `recommendation), tag every product/link exactly as given in the topic using the format ` +
          `"🏷️<Product name> : <link>" — one line per product. Never invent, shorten, or alter a link; only ` +
          `reproduce links that were actually given in the topic text.\n\n`
        : "") +
    (wantsImage
      ? `An accompanying image was requested — also include image_prompt: a vivid English description of a ` +
        `realistic photo (product shot or lifestyle scene) that fits this post.\n\n`
      : "") +
    `Call record_generated_post with the result.`;

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    // A role-driven single post can produce up to ~10,000 characters of
    // text_attachment content (~3000-4000 tokens) plus the surrounding
    // tool-call JSON — 4096 gives that room without over-provisioning the
    // common (no role) case.
    max_tokens: hasRole ? 4096 : 1500,
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

  const result = toolUse.input as {
    topic_used?: string;
    posts?: string[];
    text_attachment?: string;
    image_prompt?: string;
  };
  const posts = Array.isArray(result.posts) ? result.posts.filter((p) => typeof p === "string" && p.trim()) : [];

  if (posts.length === 0) {
    throw new Error("Generated result was empty — try again");
  }

  // Only meaningful for a single post — a thread already spreads long
  // content across multiple items, so text_attachment (which only attaches
  // to one post) doesn't apply there.
  const textAttachment =
    postType === "single" && typeof result.text_attachment === "string" && result.text_attachment.trim()
      ? result.text_attachment.trim()
      : null;

  let imageUrl: string | null = null;
  if (wantsImage && result.image_prompt) {
    try {
      const { buffer, contentType } = await generateImage(result.image_prompt);
      imageUrl = await uploadGeneratedImage(buffer, contentType);
    } catch {
      // Non-fatal — the text is still good on its own. Caller/UI just
      // won't have an image for this one.
      imageUrl = null;
    }
  }

  return { posts, creatorUsername: creator?.username ?? null, imageUrl, textAttachment };
}
