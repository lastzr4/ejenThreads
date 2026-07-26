import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processAutoCommentForUser } from "@/lib/auto-comment/process-auto-comment";

// Auto-Comment's tick — sibling to app/api/cron/run-schedules/route.ts,
// triggered by the same server.js setInterval. Runs once per user with
// auto_comment_enabled=true; processAutoCommentForUser itself enforces the
// daily cap and the random delay between comments (auto_comment_next_
// eligible_at), so most ticks for most users are a no-op — that's expected,
// not a bug.

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

  const { data: enabledUsers, error } = await supabase
    .from("user_settings")
    .select("user_id")
    .eq("auto_comment_enabled", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<{ userId: string; ok: boolean; posted: boolean; reason?: string; error?: string }> = [];

  for (const row of enabledUsers ?? []) {
    const result = await processAutoCommentForUser(supabase, row.user_id as string);
    results.push({ userId: row.user_id as string, ...result });
  }

  return NextResponse.json({ processed: results.length, results });
}
