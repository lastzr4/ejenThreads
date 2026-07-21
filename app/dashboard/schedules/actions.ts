"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { processSchedule } from "@/lib/scheduler/process-schedule";

const ALLOWED_INTERVALS = [1, 2, 4, 6, 12, 24];

export async function createSchedule(formData: FormData) {
  const creatorId = String(formData.get("creatorId") ?? "");
  const intervalHours = Number(formData.get("intervalHours"));
  const postType = formData.get("postType") === "thread" ? "thread" : "single";
  const topic = String(formData.get("topic") ?? "").trim();

  if (!creatorId || !ALLOWED_INTERVALS.includes(intervalHours)) {
    redirect("/dashboard/schedules?error=Pick+a+creator+and+a+valid+interval");
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: analysis } = await supabase
    .from("creator_analysis")
    .select("id")
    .eq("creator_id", creatorId)
    .maybeSingle();

  if (!analysis) {
    redirect(
      "/dashboard/schedules?error=" +
        encodeURIComponent("That creator hasn't been Studied yet — click Study on their page first")
    );
  }

  const { error } = await supabase.from("posting_schedules").insert({
    user_id: user.id,
    creator_id: creatorId,
    interval_hours: intervalHours,
    post_type: postType,
    topic: topic || null,
    next_run_at: new Date().toISOString()
  });

  if (error) {
    redirect(`/dashboard/schedules?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/schedules");
  redirect("/dashboard/schedules?message=Schedule%20created");
}

export async function toggleSchedule(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "true";
  if (!id) return;

  const supabase = createClient();
  const { error } = await supabase.from("posting_schedules").update({ is_active: !isActive }).eq("id", id);

  if (error) {
    redirect(`/dashboard/schedules?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/schedules");
  redirect("/dashboard/schedules");
}

export async function deleteSchedule(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const { error } = await supabase.from("posting_schedules").delete().eq("id", id);

  if (error) {
    redirect(`/dashboard/schedules?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/schedules");
  redirect("/dashboard/schedules");
}

/**
 * Runs one schedule immediately — same generate-then-publish logic the
 * cron tick uses (lib/scheduler/process-schedule.ts), just triggered on
 * demand instead of waiting up to an hour+ for the interval. Handy for
 * testing a schedule right after creating it, without waiting.
 */
export async function runScheduleNow(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: schedule } = await supabase
    .from("posting_schedules")
    .select("id, user_id, creator_id, interval_hours, post_type, topic")
    .eq("id", id)
    .single();

  if (!schedule) {
    redirect("/dashboard/schedules?error=Schedule%20not%20found");
  }

  const result = await processSchedule(supabase, schedule);

  revalidatePath("/dashboard/schedules");
  revalidatePath("/dashboard/drafts");
  redirect(
    result.ok
      ? "/dashboard/schedules?message=" + encodeURIComponent("Ran now — check Drafts for the result")
      : "/dashboard/schedules?error=" + encodeURIComponent(result.error ?? "Run failed")
  );
}
