// Official Threads Insights API (developers.facebook.com/docs/threads/insights)
// — read-only, separate scope (threads_manage_insights) from publishing.
// Used by the "Past performance" feature (lib/threads/sync-metrics.ts) to
// pull real engagement numbers for posts this app published.

const GRAPH_BASE = "https://graph.threads.net/v1.0";

export interface PostInsights {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  shares: number | null;
}

/**
 * Fetches lifetime engagement metrics for one of THIS app's own published
 * posts. Threads has no literal "reach" metric at the post level — `views`
 * (times played/displayed) is the closest equivalent, shown as "Reach" in
 * the UI. `shares` (and `views`) are marked by Meta as metrics still "in
 * development" and can come back missing/zero even on real posts — treated
 * as just another value here, not an error.
 *
 * Returns null (never throws) on any failure — a transient Insights API
 * error shouldn't break the sync loop for every other post. Missing
 * individual metrics in the response come back as null, not 0, so the UI
 * can distinguish "genuinely zero" from "Threads didn't return this one".
 */
export async function fetchPostInsights(threadsMediaId: string, accessToken: string): Promise<PostInsights | null> {
  try {
    const url = new URL(`${GRAPH_BASE}/${threadsMediaId}/insights`);
    url.searchParams.set("metric", "views,likes,replies,reposts,quotes,shares");
    url.searchParams.set("access_token", accessToken);

    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok) {
      console.error(
        "[fetchPostInsights] Threads API error:",
        data?.error?.message || data?.error_message || `HTTP ${res.status}`
      );
      return null;
    }

    const rows = Array.isArray(data?.data) ? data.data : [];
    const valueByName = new Map<string, number>();
    for (const row of rows) {
      const name = row?.name;
      const value = row?.values?.[0]?.value;
      if (typeof name === "string" && typeof value === "number") {
        valueByName.set(name, value);
      }
    }

    return {
      views: valueByName.get("views") ?? null,
      likes: valueByName.get("likes") ?? null,
      replies: valueByName.get("replies") ?? null,
      reposts: valueByName.get("reposts") ?? null,
      quotes: valueByName.get("quotes") ?? null,
      shares: valueByName.get("shares") ?? null
    };
  } catch (err) {
    console.error("[fetchPostInsights] failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
