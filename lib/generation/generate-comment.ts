import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic/client";

// Auto-Comment's generator — deliberately much simpler than
// generate-styled-post.ts (no style profile, no niche, no image, no thread
// chain): a single short, generically friendly reply to someone else's post,
// meant to read like a normal supportive Threads comment, not a post of its
// own. Kept in its own file rather than reusing generateStyledPost because
// the shape of the problem (and the tool schema) is genuinely different —
// this writes ~1 short sentence, not a styled post/thread/carousel.

const COMMENT_TOOL = {
  name: "record_comment",
  description: "Record a short, friendly reply to someone else's Threads post.",
  input_schema: {
    type: "object" as const,
    properties: {
      comment: {
        type: "string",
        description:
          "A short (under 150 characters), genuine-sounding, friendly reply to the post below. Generic " +
          "supportive tone — agree, react, or add a brief relatable thought. No hashtags, no emojis unless " +
          "they fit naturally, no links, no self-promotion, and never mention that this is AI-generated."
      }
    },
    required: ["comment"]
  }
};

/**
 * Throws a plain Error on any failure (no post text, Claude/API error, empty
 * result) — callers (lib/auto-comment/process-auto-comment.ts) should treat
 * one post's failure as skippable, not fatal to the whole cycle.
 */
export async function generateComment(postText: string): Promise<string> {
  const trimmed = postText.trim();
  if (!trimmed) {
    throw new Error("Post has no text to react to");
  }

  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 200,
    system:
      "You write short, genuine-sounding replies to social media posts, the way a real supportive reader " +
      "would comment — never a generic bot-sounding line, never mentioning you're an AI. Call record_comment " +
      "exactly once with your result.",
    messages: [
      {
        role: "user",
        content: `Here is a Threads post:\n\n"${trimmed}"\n\nCall record_comment with a short, friendly reply to it.`
      }
    ],
    tools: [COMMENT_TOOL],
    tool_choice: { type: "tool", name: "record_comment" }
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a comment");
  }

  const result = toolUse.input as { comment?: string };
  const comment = typeof result.comment === "string" ? result.comment.trim() : "";

  if (!comment) {
    throw new Error("Generated comment was empty — try again");
  }

  return comment;
}
