/**
 * Generic loading skeleton reused by every app/dashboard/**\/loading.tsx.
 * Next.js shows this instantly on navigation while the target route's
 * Server Component data-fetches (creators, drafts, schedules, etc.) — much
 * better than the frozen/blank screen you get with no loading.tsx at all,
 * which is what made tab-switching feel laggy even though the underlying
 * fetch time didn't actually change.
 */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-40 rounded bg-slate-200" />
        <div className="h-4 w-72 rounded bg-slate-100" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-20 rounded-md border border-slate-100 bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
