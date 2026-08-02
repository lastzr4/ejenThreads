import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getAnthropicClient, ANTHROPIC_MODEL } from "@/lib/anthropic/client";
import { hookTypeLabels } from "@/lib/hook-types";
import { nicheLabel } from "@/lib/niches";

// "Past performance" — the AI analyzes this user's own real published-post
// results (lib/threads/sync-metrics.ts keeps metric_* fresh) to identify
// which hook/niche/role/timing choices actually performed, in plain
// language, and — separately — generate-styled-post.ts folds a condensed
// version of the result back into future generation prompts so suggestions
// keep improving instead of staying static.

const MIN_POSTS_REQUIRED = 5;

const ANALYSIS_TOOL = {
  name: "record_performance_analysis",
  description: "Record an analysis of which past post patterns performed well or poorly, and why.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: {
        type: "string",
        description:
          "A short (2-4 sentence) plain-language overview of the overall picture — write in Malay, the same " +
          "language the user writes to this app in."
      },
      best_patterns: {
        type: "string",
        description:
          "Which hook types, niches, roles/formats, or content patterns correlated with the strongest " +
          "engagement (views/likes/replies/reposts/shares), with brief reasoning for WHY they likely worked. " +
          "Write in Malay. Be specific and reference the actual posts/patterns, not generic advice."
      },
      worst_patterns: {
        type: "string",
        description:
          "Which patterns correlated with weak engagement, and a plausible reason why. Write in Malay. If " +
          "nothing stands out as clearly weak, say so honestly rather than inventing a pattern."
      },
      timing_notes: {
        type: "string",
        description:
          "Any pattern in posting time (day of week, time of day) that correlated with better/worse " +
          "engagement. Write in Malay. If the sample is too small or no timing pattern is visible, say so " +
          "honestly instead of guessing."
      },
      recommendations: {
        type: "string",
        description:
          "3-5 concrete, actionable recommendations for future posts (hook types to favor, formats to try " +
          "more/less, timing to prefer), written in Malay as short bullet-style lines separated by newlines. " +
          "This gets fed back into future post generation, so keep it concrete and directly actionable rather " +
          "than vague encouragement."
      }
    },
    required: ["summary", "best_patterns", "worst_patterns", "timing_notes", "recommendations"]
  }
};

export interface PerformanceAnalysisResult {
  summary: string;
  bestPatterns: string;
  worstPatterns: string;
  timingNotes: string;
  recommendations: string;
  basedOnPostCount: number;
}

function dayAndHour(iso: string | null): string {
  if (!iso) return "unknown time";
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const hour = d.getUTCHours();
  return `${day} ~${hour}:00 UTC`;
}

/**
 * Throws a plain Error with a user-facing message if there isn't enough
 * synced data yet (see MIN_POSTS_REQUIRED) or if Claude/the DB call fails.
 * Overwrites the previous analysis on success — same "latest state, not a
 * history log" pattern as creator_analysis (Module 2).
 */
export async function analyzePerformance(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  userId: string
): Promise<PerformanceAnalysisResult> {
  const { data: posts } = await supabase
    .from("scheduled_posts")
    .select(
      `content_draft, niche, role_prompt, hook_types, post_type, posted_at, metric_views, metric_likes,
      metric_replies, metric_reposts, metric_quotes, metric_shares, creators(username)`
    )
    .eq("user_id", userId)
    .eq("status", "posted")
    .not("metrics_updated_at", "is", null)
    .order("posted_at", { ascending: false })
    .limit(50);

  const rows = posts ?? [];

  if (rows.length < MIN_POSTS_REQUIRED) {
    throw new Error(
      `Belum cukup data — perlukan sekurang-kurangnya ${MIN_POSTS_REQUIRED} post yang sudah posted dan metrics ` +
        `disync (ada ${rows.length} setakat ini). Metrics disync automatik lepas post published — cuba lagi ` +
        "sebentar lagi."
    );
  }

  const postsBlock = rows
    .map((p, i) => {
      const username = (p.creators as unknown as { username: string } | null)?.username;
      const text = Array.isArray(p.content_draft) ? (p.content_draft as string[]).join(" / ") : "";
      const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
      const hooks = hookTypeLabels(p.hook_types as string[] | null).join(", ") || "none picked";
      const niche = nicheLabel(p.niche as string | null) ?? "none picked";
      const role = (p.role_prompt as string | null)?.trim();

      return (
        `Post ${i + 1} (@${username ?? "unknown"}, ${p.post_type}, posted ${dayAndHour(p.posted_at as string | null)}):\n` +
        `  Hook type(s): ${hooks}\n` +
        `  Niche: ${niche}\n` +
        (role ? `  Role: ${role.slice(0, 150)}\n` : "") +
        `  Text: "${preview}"\n` +
        `  Metrics: views=${p.metric_views ?? "n/a"}, likes=${p.metric_likes ?? "n/a"}, ` +
        `replies=${p.metric_replies ?? "n/a"}, reposts=${p.metric_reposts ?? "n/a"}, ` +
        `quotes=${p.metric_quotes ?? "n/a"}, shares=${p.metric_shares ?? "n/a"}`
      );
    })
    .join("\n\n");

  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1500,
    system:
      "You are a social media performance analyst. You are given a list of a user's own real published " +
      "Threads posts, each with the choices behind it (hook type, niche, role/format, posting time) and its " +
      "real engagement metrics. Find genuine correlations and give honest, specific, actionable analysis — " +
      "never invent a pattern that isn't actually supported by the data, and say so plainly when the sample " +
      "is too small or too mixed to draw a confident conclusion about something. Call " +
      "record_performance_analysis exactly once with your result.",
    messages: [
      {
        role: "user",
        content:
          `Analyze these ${rows.length} published Threads posts and their real engagement metrics:\n\n${postsBlock}\n\n` +
          `Call record_performance_analysis with your analysis.`
      }
    ],
    tools: [ANALYSIS_TOOL],
    tool_choice: { type: "tool", name: "record_performance_analysis" }
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a performance analysis");
  }

  const result = toolUse.input as {
    summary?: string;
    best_patterns?: string;
    worst_patterns?: string;
    timing_notes?: string;
    recommendations?: string;
  };

  const analysis: PerformanceAnalysisResult = {
    summary: result.summary?.trim() || "",
    bestPatterns: result.best_patterns?.trim() || "",
    worstPatterns: result.worst_patterns?.trim() || "",
    timingNotes: result.timing_notes?.trim() || "",
    recommendations: result.recommendations?.trim() || "",
    basedOnPostCount: rows.length
  };

  const { error } = await supabase.from("performance_insights").upsert(
    {
      user_id: userId,
      summary: analysis.summary,
      best_patterns: analysis.bestPatterns,
      worst_patterns: analysis.worstPatterns,
      timing_notes: analysis.timingNotes,
      recommendations: analysis.recommendations,
      based_on_post_count: analysis.basedOnPostCount,
      generated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(error.message);
  }

  return analysis;
}
