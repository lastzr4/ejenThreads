import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/app-version";

// Polled client-side by components/version-watcher.tsx to detect a new
// deploy. force-dynamic + no-store headers on both the route and the
// response so nothing (Next's own caching, a CDN, the browser) ever serves
// a stale answer here — the whole point is catching a real version change.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ version: APP_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
