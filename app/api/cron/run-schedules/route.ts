import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processSchedule } from "@/lib/scheduler/process-schedule";

// Module 4 — the actual "auto-post every N hours" tick. Triggered by
// server.js's internal setInterval (every 60s), never called directly by
// users. Protected by CRON_SECRET so the public URL can't be used to spam
// generation/publishing by anyone who finds it.
//
// The actual generate -> publish -> record logic lives in
// lib/scheduler/process-schedule.ts, shared with the manual "Run now"
// button (app/dashboard/schedules/actions.ts) — this route is just the
// "find everything due, right now, across every user" loop around it.
//
// Uses the service-role admin client — this runs with no per-request user
// session, and needs to see every user's schedules, not just one, so RLS
// (correct and desired everywhere else in this app) doesn't apply here.

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured — allow (local/dev convenience)
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: dueSchedules, error: scheduleError } = await supabase
    .from("posting_schedules")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_at", nowIso);

  if (scheduleError) {
    return NextResponse.json({ error: scheduleError.message }, { status: 500 });
  }

  const results: Array<{ scheduleId: string; ok: boolean; error?: string }> = [];

  for (const schedule of dueSchedules ?? []) {
    const result = await processSchedule(supabase, schedule);
    results.push({ scheduleId: schedule.id, ...result });
  }

  return NextResponse.json({ processed: results.length, results });
}
