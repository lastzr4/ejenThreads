"use client";

import { useEffect, useState } from "react";
import { signOutForUpdate } from "@/app/login/actions";

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — frequent enough to catch a deploy within the same session, cheap enough not to matter
const COUNTDOWN_SECONDS = 20;

/**
 * Detects when a new version of the app has been deployed while this tab
 * was already open (see lib/app-version.ts — the server's APP_VERSION
 * changes on every Railway restart, i.e. every deploy) and forces a clean
 * sign-out + re-login so the client picks up the new bundle instead of
 * running stale JS indefinitely. Real risk here specifically because the
 * PWA service worker (public/sw.js) also caches hashed static assets, so a
 * tab left open across a deploy could otherwise keep serving old code far
 * longer than a normal website would.
 *
 * Deliberately a real sign-out via signOutForUpdate (app/login/actions.ts),
 * not just a page reload — guarantees a fresh Supabase session too, and
 * gives an explained, visible moment (countdown banner) rather than a
 * silent reload that could look like a random glitch or lost work.
 */
export function VersionWatcher({ initialVersion }: { initialVersion: string }) {
  const [updateDetected, setUpdateDetected] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/app-version", { cache: "no-store" });
        const data = await res.json();
        if (data?.version && data.version !== initialVersion) {
          setUpdateDetected(true);
        }
      } catch {
        // Transient network hiccup — just try again next poll.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [initialVersion]);

  useEffect(() => {
    if (!updateDetected) return;
    if (countdown <= 0) {
      signOutForUpdate();
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [updateDetected, countdown]);

  if (!updateDetected) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-amber-600 px-4 py-3 text-center text-sm text-white">
      <span>
        Kemaskini baru CopyCreator tersedia — log keluar automatik dalam {countdown} saat untuk refresh.
      </span>
      <button
        type="button"
        onClick={() => signOutForUpdate()}
        className="rounded-md bg-white/20 px-3 py-1 font-medium hover:bg-white/30"
      >
        Refresh sekarang
      </button>
    </div>
  );
}
