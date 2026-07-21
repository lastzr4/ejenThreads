"use client";

import { useEffect, useState } from "react";

/**
 * Renders a timestamp using the VIEWER's own timezone/locale.
 *
 * Every date in this app was previously formatted with
 * `new Date(iso).toLocaleString()` directly inside Server Components —
 * which runs that formatting on the server (Railway's container), not in
 * the user's browser. Railway's container timezone isn't the user's
 * timezone, so times were silently off (e.g. a schedule's "next run"
 * showing a time that didn't match the viewer's clock at all).
 *
 * This is a client component specifically so `toLocaleString()` runs in
 * the browser instead. Renders a placeholder until mounted to avoid a
 * hydration mismatch (server has no way to know the browser's timezone
 * ahead of time, so it can't pre-render the real value).
 */
export function LocalDateTime({
  iso,
  dateOnly = false
}: {
  iso: string | null | undefined;
  dateOnly?: boolean;
}) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) {
      setFormatted(null);
      return;
    }
    const date = new Date(iso);
    setFormatted(dateOnly ? date.toLocaleDateString() : date.toLocaleString());
  }, [iso, dateOnly]);

  if (!iso) return null;
  return <>{formatted ?? "…"}</>;
}
