import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic/client";
import { nicheLabel } from "@/lib/niches";
import { hookTypeGuidance } from "@/lib/hook-types";
import { generateImage } from "@/lib/gemini/generate-image";
import { uploadGeneratedImage } from "@/lib/storage/upload-image";
import { extractShopeeUrl, fetchShopeeProductInfo } from "@/lib/shopee/fetch-product-image";

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
          "Only for a single accompanying image (postType is single or thread, not carousel) if one was " +
          "requested (see instructions). A vivid, concrete English description for an image generator — " +
          "describe a real photo-style scene (product shot, lifestyle photo, etc.) that fits the post. " +
          "Omit entirely if no image was requested, or if this is a carousel (use image_prompts instead)."
      },
      image_prompts: {
        type: "array",
        items: { type: "string" },
        description:
          "Only for a carousel post (postType carousel) if images were requested — the exact number of " +
          "distinct, vivid English photo descriptions asked for in the instructions, one per carousel " +
          "image, ordered the way they should appear when a reader swipes through (e.g. a before/after " +
          "sequence, steps in a process, different angles of a product). Each should be visually distinct " +
          "but thematically cohesive with the others. Omit entirely if not a carousel or no image was requested."
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
  postType: "single" | "thread" | "carousel";
  niche?: string | null;
  generateImage?: boolean;
  /**
   * How many AI images to generate when postType is "carousel" and
   * generateImage is true. Ignored otherwise (single/thread only ever
   * generate one image). Threads allows 2-20 images in a real carousel;
   * this is clamped by the caller (see app/dashboard/creators/generate-
   * actions.ts and app/dashboard/schedules/actions.ts) before reaching
   * here, but defaults conservatively if omitted.
   */
  carouselImageCount?: number;
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
  /**
   * One or more "Jenis Hook" presets (see lib/hook-types.ts — storytelling,
   * FOMO, curiosity, social proof, etc.) steering how the post's OPENING is
   * framed. Unlike `role` (overall shape/structure), this only governs the
   * hook — the first line(s) that grab attention. Multiple values are
   * blended into one cohesive opening rather than mechanically stacked.
   * Unrecognized values are silently dropped (see hookTypeGuidance).
   */
  hookTypes?: string[] | null;
  /**
   * Optional override for the IMAGE specifically (separate from `role`,
   * which governs the post TEXT's shape/structure) — e.g. "seorang
   * perempuan nak dating pakai item ini". Only meaningful when an image is
   * requested for a single/thread post. When the Topic contains a Shopee
   * link, the real product photo is fetched (see lib/shopee/fetch-product-
   * image.ts) and used as a reference so the product's actual appearance
   * stays accurate — this field then directs the SCENE built around it
   * (e.g. a lifestyle moment) rather than the product's look. Without a
   * Shopee link, it still steers Claude's own image_prompt the same way,
   * just without a real photo to anchor it. Ignored for carousels (each
   * carousel slide already gets its own AI-decided image_prompt).
   */
  imageDirection?: string | null;
  /**
   * A real product photo supplied directly by the user (e.g. saved from the
   * Shopee listing themselves) — takes priority over auto-scraping a
   * Shopee link out of the topic (see lib/shopee/fetch-product-image.ts),
   * since a user-supplied photo is always accurate where auto-scraping can
   * grab the wrong image (a site logo/banner instead of the real product).
   * Used the same way: as a Gemini reference image, not as the final post
   * image outright — the AI still composes a fresh scene around it.
   */
  referenceImageOverride?: { buffer: Buffer; mimeType: string } | null;
}

export interface GenerateStyledPostResult {
  posts: string[];
  creatorUsername: string | null;
  imageUrl: string | null;
  /**
   * Set only for a carousel (postType === "carousel") when AI image
   * generation was requested — 2+ image URLs, one per carousel slide, in
   * the order Claude described them. Null otherwise (including when a
   * carousel's images all failed to generate — see imageError).
   */
  imageUrls: string[] | null;
  /**
   * Set whenever an image was requested but generation/upload failed —
   * previously this was silently discarded (caught, imageUrl left null, no
   * trace anywhere), which made "the image just never shows up" impossible
   * to diagnose without direct server log access. Null when no image was
   * requested, or when it succeeded. For a carousel, also set (as a
   * partial warning, not necessarily fatal) if some but not all images
   * failed.
   */
  imageError: string | null;
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
  hookTypes,
  generateImage: wantsImage = false,
  carouselImageCount = 3,
  imageDirection,
  referenceImageOverride
}: GenerateStyledPostParams): Promise<GenerateStyledPostResult> {
  const { data: creator } = await supabase
    .from("creators")
    .select("username, knowledge_base_text")
    .eq("id", creatorId)
    .single();

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

  const knowledgeBase = (creator?.knowledge_base_text ?? "").trim();
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
  const hookGuidance = hookTypeGuidance(hookTypes);
  // 2-20 mirrors publishCarouselPost's own limits (lib/threads/publish.ts) —
  // clamped here too as a safety net in case a caller passes something out
  // of range instead of clamping it themselves.
  const carouselCount = postType === "carousel" ? Math.min(20, Math.max(2, carouselImageCount)) : 0;

  const postTypeLabel =
    postType === "thread" ? "thread (multiple sequential posts)" : postType === "carousel" ? "carousel post" : "post";

  // Only single/thread posts get a reference-photo image (see the wantsImage
  // result-handling below) — carousels already generate their own set of
  // AI-imagined images per slide via image_prompts, a real single reference
  // photo doesn't map cleanly onto that yet.
  const shopeeUrl = postType !== "carousel" ? extractShopeeUrl(topic ?? null) : null;
  const hasImageDirection = Boolean(imageDirection && imageDirection.trim());

  const userPrompt =
    `Write a brand-new, original Threads ${postTypeLabel} ` +
    `in the voice of @${creator?.username ?? "this creator"}, based on the style profile below.\n\n` +
    (postType === "carousel"
      ? `This will be published as a single Threads carousel — ${carouselCount} images the reader swipes ` +
        `through, all under ONE shared caption. Write exactly one caption (a single item in "posts"), not a ` +
        `split thread — the images themselves carry the multi-part structure, not separate reply posts.\n\n`
      : "") +
    `STYLE PROFILE:\n` +
    `Tone: ${analysis.style_tone}\n` +
    `Hook patterns: ${JSON.stringify(analysis.hook_patterns)}\n` +
    `Threading structure: ${JSON.stringify(analysis.threading_structure)}\n` +
    `Emoji usage: ${JSON.stringify(analysis.emoji_usage)}\n` +
    `CTA patterns: ${JSON.stringify(analysis.cta_patterns)}\n` +
    `Vocabulary notes: ${analysis.vocabulary_notes}\n` +
    `Style guide: ${analysis.generated_rules}\n\n` +
    (examplesBlock ? `REAL EXAMPLES (for rhythm/length reference only — do not copy):\n${examplesBlock}\n\n` : "") +
    (knowledgeBase
      ? `REFERENCE KNOWLEDGE BASE (uploaded by the user for this creator — use this as background/source ` +
        `material; the post should draw on, reference, or revolve around facts and ideas from this content ` +
        `where it fits the topic, rather than only relying on generic style):\n${knowledgeBase}\n\n`
      : "") +
    (hasRole
      ? `ROLE / FORMAT INSTRUCTIONS (these take priority over generic formatting — follow them for the ` +
        `overall shape, narrative structure, and framing of this post; still write in the creator's tone/ ` +
        `voice from the style profile above):\n${role!.trim()}\n\n` +
        (postType === "thread"
          ? `Use as many sequential posts as the story/format genuinely needs — not limited to 2-3 if a ` +
            `fuller narrative arc calls for more.\n\n`
          : postType === "carousel"
            ? `Write the single shared caption for this carousel — do not split it into multiple posts or a ` +
              `reply chain; the ${carouselCount} images carry the multi-part structure instead.\n\n`
            : `Prefer a SINGLE post if the content comfortably fits under ~450 characters — just write the ` +
              `whole thing in "posts" as one item. But if this role/format genuinely needs more room (e.g. a ` +
              `full short story), do NOT cram it into one post or cut it short. Instead write it as a natural ` +
              `sequence: the first post stands alone, and each following part continues as a reply/comment on ` +
              `the previous one (same mechanism as a thread) — return each part as its own item in "posts", ` +
              `each under ~450 characters, in reading order. The reader experiences it as one continuous post ` +
              `followed by its own comment thread, so keep each part self-contained enough to read naturally ` +
              `as a continuation rather than a jarring cut.\n\n`)
      : "") +
    (hookGuidance.length > 0
      ? `HOOK STYLE for the opening (the first line(s) that grab attention)${
          hookGuidance.length > 1 ? " — blend these naturally into ONE cohesive opening, don't mechanically stack them one after another" : ""
        }:\n${hookGuidance.map((g) => `- ${g}`).join("\n")}\n\n`
      : "") +
    (nicheDescription ? `Niche/category to write within: ${nicheDescription}\n\n` : "") +
    (topic
      ? `Topic to write about: ${topic}\n\n`
      : `No specific topic was given — pick one that fits this creator's usual themes` +
        (nicheDescription ? ` and the niche above` : "") +
        `.\n\n`) +
    (wantsAffiliateHookFormat
      ? (hookGuidance.length > 0
          ? `AFFILIATE POST FORMAT: after the opening (follow the HOOK STYLE above for it — don't use a ` +
            `different hook style here), on separate lines, tag every product/link exactly as given in the ` +
            `topic above using the format "🏷️<Product name> : <link>" — one line per product. Never invent, ` +
            `shorten, or alter a link; only reproduce links that were actually given in the topic text.\n\n`
          : `AFFILIATE POST FORMAT: open with a short, punchy, emotionally relatable hook (1-2 sentences) — ` +
            `Malaysian social-media style often uses an ironic "plot twist" framing (expecting something bad, ` +
            `pleasantly surprised, or vice versa), ending with an emotive emoji if it fits the creator's style. ` +
            `Then, on separate lines, tag every product/link exactly as given in the topic above using the ` +
            `format "🏷️<Product name> : <link>" — one line per product. Never invent, shorten, or alter a ` +
            `link; only reproduce links that were actually given in the topic text.\n\n`)
      : hasRole && hasLinksToTag
        ? `Somewhere that fits the role/format above (e.g. near the end, as a natural pivot to a ` +
          `recommendation), tag every product/link exactly as given in the topic using the format ` +
          `"🏷️<Product name> : <link>" — one line per product. Never invent, shorten, or alter a link; only ` +
          `reproduce links that were actually given in the topic text.\n\n`
        : "") +
    (wantsImage
      ? postType === "carousel"
        ? `${carouselCount} accompanying images were requested — include image_prompts: exactly ${carouselCount} ` +
          `vivid English photo descriptions, one per carousel slide, in swipe order (e.g. a before/after pair, ` +
          `steps in a process, or different angles/moments of the same product or scene) — distinct from each ` +
          `other but visually cohesive as a set.\n\n`
        : shopeeUrl
          ? `An accompanying image was requested — a REAL photo of the actual product (from the Shopee link ` +
            `in the topic) will be attached separately as a reference, so its true appearance is already ` +
            `covered. For image_prompt, describe ONLY the surrounding scene/context/composition to build ` +
            `around that product — NOT the product's own look (don't redescribe its shape/color/packaging, ` +
            `that comes from the reference photo) — ` +
            (hasImageDirection
              ? `following this specific direction: "${imageDirection!.trim()}".\n\n`
              : `a vivid, photorealistic, social-media-optimized lifestyle scene with strong viral/high-` +
                `engagement potential.\n\n`)
          : `An accompanying image was requested — also include image_prompt: a vivid English description of a ` +
            `realistic photo (product shot or lifestyle scene) that fits this post` +
            (hasImageDirection ? `, following this direction: "${imageDirection!.trim()}"` : "") +
            `.\n\n`
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
    image_prompts?: string[];
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
  let imageUrls: string[] | null = null;
  let imageError: string | null = null;

  if (wantsImage && postType === "carousel") {
    const prompts = Array.isArray(result.image_prompts)
      ? result.image_prompts.filter((p) => typeof p === "string" && p.trim())
      : [];

    if (prompts.length < 2) {
      imageError = `A carousel needs at least 2 images, but Claude only returned ${prompts.length} image_prompts`;
    } else {
      // Each image is generated (Gemini) and uploaded independently, in
      // parallel — one bad prompt/transient failure shouldn't sink the
      // whole carousel. As long as at least 2 succeed, the carousel still
      // publishes with fewer slides than asked for (Threads' own minimum);
      // imageError reports how many were skipped either way.
      const settled = await Promise.allSettled(
        prompts.map(async (prompt) => {
          const { buffer, contentType } = await generateImage(prompt);
          return uploadGeneratedImage(buffer, contentType);
        })
      );
      const urls = settled
        .filter((s): s is PromiseFulfilledResult<string> => s.status === "fulfilled")
        .map((s) => s.value);
      const failedCount = settled.length - urls.length;

      if (failedCount > 0) {
        console.error(
          `[generateStyledPost] ${failedCount} of ${settled.length} carousel images failed:`,
          settled.filter((s) => s.status === "rejected")
        );
      }

      if (urls.length >= 2) {
        imageUrls = urls;
        if (failedCount > 0) {
          imageError = `${failedCount} of ${settled.length} carousel images failed to generate and were skipped.`;
        }
      } else {
        imageError = `Carousel image generation mostly failed (only ${urls.length} of ${settled.length} succeeded) — need at least 2.`;
      }
    }
  } else if (wantsImage) {
    if (!result.image_prompt && !hasImageDirection) {
      // Shouldn't normally happen since wantsImage adds an instruction to
      // include image_prompt, but Claude can still omit it. (An
      // imageDirection override alone is still enough to proceed even
      // without one — see the fallback scene text below.)
      imageError = "Image was requested but Claude didn't return an image_prompt to generate from";
    } else {
      try {
        // A user-supplied reference photo (saved from the listing
        // themselves) always wins over auto-scraping — it's guaranteed to
        // actually be the product, where scraping a Shopee link can grab
        // the wrong image entirely (e.g. a site logo/banner instead of the
        // real product, when a per-product image genuinely isn't exposed
        // to a normal page render). Only fall back to auto-scraping if no
        // override was given. Soft-fails to the old text-only behavior if
        // neither is available/works out — never fatal to the post itself.
        const productPhoto = referenceImageOverride
          ? { imageBuffer: referenceImageOverride.buffer, imageMimeType: referenceImageOverride.mimeType }
          : shopeeUrl
            ? await fetchShopeeProductInfo(shopeeUrl)
            : null;

        const scenePrompt =
          result.image_prompt ||
          imageDirection!.trim(); // hasImageDirection guarantees this is non-empty when image_prompt is missing

        const finalPrompt = productPhoto
          ? `Using the exact product shown in the attached reference photo, keep its real appearance ` +
            `(shape, color, packaging/label, material) accurate and unchanged. Build a fresh, vivid, ` +
            `photorealistic, social-media-optimized scene around it: ${scenePrompt}`
          : scenePrompt;

        const { buffer, contentType } = await generateImage(
          finalPrompt,
          productPhoto ? { buffer: productPhoto.imageBuffer, mimeType: productPhoto.imageMimeType } : undefined
        );
        imageUrl = await uploadGeneratedImage(buffer, contentType);
      } catch (err) {
        // Non-fatal to the whole generation — the text is still good on
        // its own — but no longer silent: logged server-side and surfaced
        // to the caller so it shows up on the draft instead of just
        // vanishing with zero trace.
        imageError = err instanceof Error ? err.message : "Image generation failed";
        console.error("[generateStyledPost] image generation/upload failed:", err);
      }
    }
  }

  return { posts, creatorUsername: creator?.username ?? null, imageUrl, imageUrls, imageError, textAttachment };
}
