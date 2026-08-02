// Shared "Jenis Hook" (hook type) presets — used by both the manual
// Generate form (app/dashboard/creators/[id]/page.tsx) and the Schedules
// create form (app/dashboard/schedules/page.tsx), same dual-use pattern as
// lib/niches.ts. Multiple can be selected at once; generate-styled-post.ts
// asks Claude to blend all selected ones naturally into the post's opening
// rather than mechanically stacking them.
export const HOOK_TYPE_OPTIONS: Array<{ value: string; label: string; guidance: string }> = [
  {
    value: "storytelling",
    label: "Storytelling",
    guidance:
      "Storytelling — open with a short, vivid personal or narrative scene/anecdote that pulls the reader " +
      "into a moment before making the point."
  },
  {
    value: "fomo",
    label: "FOMO",
    guidance:
      "FOMO — open with a sense of urgency or a limited window that creates a fear of missing out (e.g. " +
      "limited stock, ending soon, a shrinking opportunity)."
  },
  {
    value: "problem_solution",
    label: "Problem Solution",
    guidance:
      "Problem → Solution — state a specific, relatable problem/pain point up front, then position what " +
      "follows as the fix."
  },
  {
    value: "curiosity",
    label: "Curiosity",
    guidance:
      "Curiosity — open with an intriguing question, incomplete statement, or surprising fact that creates a " +
      "curiosity gap the reader wants closed."
  },
  {
    value: "social_proof",
    label: "Social Proof",
    guidance:
      "Social Proof — open by referencing what others are already doing/saying/experiencing (e.g. \"ramai dah " +
      "cuba...\", a number of people, a trend) to build trust through crowd behavior."
  },
  {
    value: "transformation",
    label: "Transformation",
    guidance: "Transformation — open with a clear before → after framing (how things were vs. how they are now)."
  },
  {
    value: "vulnerable",
    label: "Vulnerable",
    guidance:
      "Vulnerable — open with an honest, personal admission or weakness that makes the writer relatable " +
      "rather than polished."
  },
  {
    value: "bold_statement",
    label: "Bold Statement",
    guidance: "Bold Statement — open with a confident, opinionated, even slightly provocative claim stated as fact."
  },
  {
    value: "relatable_struggle",
    label: "Relatable Struggle",
    guidance:
      "Relatable Struggle — open by naming a shared everyday frustration the reader will immediately " +
      "recognize as their own."
  },
  {
    value: "negative_reverse",
    label: "Negative/Reverse",
    guidance:
      "Negative/Reverse — open with a negative or discouraging statement, then pivot/reverse it into the " +
      "opposite point."
  },
  {
    value: "result_first",
    label: "Result First",
    guidance:
      "Result First — open by stating the outcome/result up front (e.g. a number, an achievement), then " +
      "explain how it happened."
  },
  {
    value: "controversy_spike",
    label: "Controversy Spike",
    guidance:
      "Controversy Spike — open with a mildly polarizing or unexpected take designed to provoke a reaction " +
      "(agree/disagree) in the comments — stay tasteful, never genuinely offensive."
  }
];

const HOOK_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  HOOK_TYPE_OPTIONS.map((o) => [o.value, o.label])
);

export function hookTypeLabels(values: string[] | null | undefined): string[] {
  if (!values || values.length === 0) return [];
  return values.map((v) => HOOK_TYPE_LABELS[v] ?? v);
}

/**
 * Builds the guidance text passed into the prompt for a set of selected
 * hook type values, dropping anything unrecognized rather than erroring —
 * a stale/renamed value stored on an old draft/schedule shouldn't break
 * generation, it should just be ignored.
 */
export function hookTypeGuidance(values: string[] | null | undefined): string[] {
  if (!values || values.length === 0) return [];
  const guidanceByValue = new Map(HOOK_TYPE_OPTIONS.map((o) => [o.value, o.guidance]));
  return values.map((v) => guidanceByValue.get(v)).filter((g): g is string => Boolean(g));
}
