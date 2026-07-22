// Shared niche presets — used by both the manual Generate form
// (app/dashboard/creators/[id]/page.tsx) and the Schedules create form
// (app/dashboard/schedules/page.tsx). Steers topic selection toward
// higher-engagement themes independent of whichever creator's writing
// style is being reused.
export const NICHE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "No preset — let it pick freely" },
  { value: "affiliate_product", label: "Affiliate / Product promo" },
  { value: "ai_technology", label: "AI / Technology" },
  { value: "relationship", label: "Relationship / Dating" },
  { value: "finance_money", label: "Finance / Money" },
  { value: "beauty_fashion", label: "Beauty / Fashion" },
  { value: "food", label: "Food" },
  { value: "health_fitness", label: "Health / Fitness" }
];

const NICHE_LABELS: Record<string, string> = Object.fromEntries(
  NICHE_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label])
);

export function nicheLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return NICHE_LABELS[value] ?? value;
}
