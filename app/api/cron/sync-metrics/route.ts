import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncPostMetricsForUser } from "@/lib/threads/sync-metrics";

// "Past performance" metrics tick — sibling to run-schedules/run-auto-
// comments, triggered by the same server.js setInterval. Runs once per
// Threads-API-connected user; syncPostMetricsForUser itself bounds how much
// work happens (only stale, recent posts, capped count), so most ticks for
// most users touch few or zero rows — expected, not a bug.

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

  const { data: connectedUsers, error } = await supabase
    .from("user_settings")
    .select("user_id")
    .not("threads_api_access_token", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ userId: string; checked: number; updated: number; skipped: number }> = [];

  for (const row of connectedUsers ?? []) {
    const result = await syncPostMetricsForUser(supabase, row.user_id as string);
    results.push({ userId: row.user_id as string, ...result });
  }

  return NextResponse.json({ processed: results.length, results });
}
