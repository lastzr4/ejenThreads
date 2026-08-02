"use client";

import { useMemo, useState } from "react";
import { LocalDateTime } from "@/components/local-datetime";
import { hookTypeLabels } from "@/lib/hook-types";
import { nicheLabel } from "@/lib/niches";

export interface PerformancePostRow {
  id: string;
  content_draft: string[] | null;
  post_type: string;
  niche: string | null;
  hook_types: string[] | null;
  posted_at: string | null;
  metric_views: number | null;
  metric_likes: number | null;
  metric_replies: number | null;
  metric_shares: number | null;
  username: string | null;
}

const METRICS = [
  { key: "metric_views", label: "Reach" },
  { key: "metric_likes", label: "Likes" },
  { key: "metric_replies", label: "Comments" },
  { key: "metric_shares", label: "Shares" }
] as const;

type MetricKey = (typeof METRICS)[number]["key"];
type SortKey = MetricKey | "posted_at";

function previewText(post: PerformancePostRow) {
  const text = Array.isArray(post.content_draft) ? post.content_draft.join(" / ") : "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text || "(no text)";
}

function sortArrow(active: boolean, dir: "asc" | "desc") {
  if (!active) return "";
  return dir === "asc" ? " ▲" : " ▼";
}

/**
 * Client-side sorting/top-N over the FULL set of posted posts passed down
 * from the server (see app/dashboard/performance/page.tsx) — no extra
 * round trips needed since the whole dataset is already small enough (one
 * user's own posted posts) to sort in the browser instantly, whichever
 * metric they want to look at.
 */
export function PerformancePostsTable({ posts }: { posts: PerformancePostRow[] }) {
  const [topMetric, setTopMetric] = useState<MetricKey>("metric_views");
  const [sortKey, setSortKey] = useState<SortKey>("posted_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const topPosts = useMemo(() => {
    return [...posts]
      .filter((p) => p[topMetric] !== null && p[topMetric] !== undefined)
      .sort((a, b) => {
        const diff = (b[topMetric] as number) - (a[topMetric] as number);
        if (diff !== 0) return diff;
        // Tie-break: most recent first — matches "TOP 10 latest highest ___".
        return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
      })
      .slice(0, 10);
  }, [posts, topMetric]);

  const sortedPosts = useMemo(() => {
    return [...posts].sort((a, b) => {
      let diff: number;
      if (sortKey === "posted_at") {
        diff = new Date(a.posted_at ?? 0).getTime() - new Date(b.posted_at ?? 0).getTime();
      } else {
        diff = (a[sortKey] ?? -1) - (b[sortKey] ?? -1);
      }
      return sortDir === "asc" ? diff : -diff;
    });
  }, [posts, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function renderRow(p: PerformancePostRow) {
    const hooks = hookTypeLabels(p.hook_types).join(", ");
    return (
      <tr key={p.id} className="border-b border-slate-100 align-top">
        <td className="py-2 pr-3">
          <p className="text-slate-700">{previewText(p)}</p>
          <p className="text-slate-400">
            @{p.username ?? "unknown"} · {p.post_type}
          </p>
        </td>
        <td className="py-2 pr-3 text-slate-600">{hooks || "—"}</td>
        <td className="py-2 pr-3 text-slate-600">{nicheLabel(p.niche) ?? "—"}</td>
        <td className="py-2 pr-3 text-slate-500">{p.posted_at ? <LocalDateTime iso={p.posted_at} /> : "—"}</td>
        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_views ?? "—"}</td>
        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_likes ?? "—"}</td>
        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_replies ?? "—"}</td>
        <td className="py-2 pr-3 text-right text-slate-700">{p.metric_shares ?? "—"}</td>
      </tr>
    );
  }

  if (posts.length === 0) {
    return <p className="text-sm text-slate-500">No published posts yet.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-medium text-slate-600">Top 10 by</p>
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setTopMetric(m.key)}
              className={`rounded-full px-3 py-1 text-xs ${
                topMetric === m.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Post</th>
                <th className="py-2 pr-3 font-medium">Hook</th>
                <th className="py-2 pr-3 font-medium">Niche</th>
                <th className="py-2 pr-3 font-medium">Posted</th>
                <th className="py-2 pr-3 text-right font-medium">Reach</th>
                <th className="py-2 pr-3 text-right font-medium">Likes</th>
                <th className="py-2 pr-3 text-right font-medium">Comments</th>
                <th className="py-2 pr-3 text-right font-medium">Shares</th>
              </tr>
            </thead>
            <tbody>{topPosts.map(renderRow)}</tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-100 pt-4">
        <p className="text-xs font-medium text-slate-600">
          All {posts.length} posted post{posts.length === 1 ? "" : "s"} — click a column to sort
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-3 font-medium">Post</th>
                <th className="py-2 pr-3 font-medium">Hook</th>
                <th className="py-2 pr-3 font-medium">Niche</th>
                <th
                  className="cursor-pointer select-none py-2 pr-3 font-medium hover:text-slate-700"
                  onClick={() => toggleSort("posted_at")}
                >
                  Posted{sortArrow(sortKey === "posted_at", sortDir)}
                </th>
                {METRICS.map((m) => (
                  <th
                    key={m.key}
                    className="cursor-pointer select-none py-2 pr-3 text-right font-medium hover:text-slate-700"
                    onClick={() => toggleSort(m.key)}
                  >
                    {m.label}
                    {sortArrow(sortKey === m.key, sortDir)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{sortedPosts.map(renderRow)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
