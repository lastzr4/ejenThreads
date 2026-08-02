"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { analyzePerformance } from "@/lib/generation/analyze-performance";
import { syncPostMetricsForUser } from "@/lib/threads/sync-metrics";

export async function refreshPerformanceAnalysis() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    await analyzePerformance(supabase, user.id);
  } catch (err) {
    redirect(
      `/dashboard/performance?error=${encodeURIComponent(err instanceof Error ? err.message : "Analysis failed")}`
    );
  }

  revalidatePath("/dashboard/performance");
  redirect(`/dashboard/performance?message=${encodeURIComponent("Analysis updated")}`);
}

export async function syncMetricsNow() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let message: string;
  try {
    const result = await syncPostMetricsForUser(supabase, user.id);
    message =
      result.checked === 0
        ? "Nothing due for a refresh right now — either everything's already up to date, or Threads API isn't connected yet."
        : `Synced ${result.updated} of ${result.checked} post(s).`;
  } catch (err) {
    redirect(
      `/dashboard/performance?error=${encodeURIComponent(err instanceof Error ? err.message : "Sync failed")}`
    );
  }

  revalidatePath("/dashboard/performance");
  redirect(`/dashboard/performance?message=${encodeURIComponent(message)}`);
}
