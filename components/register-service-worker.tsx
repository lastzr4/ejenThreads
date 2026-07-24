"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js on mount. Mounted once in the root layout (see
 * app/layout.tsx) so it runs on every page. Silent no-op on browsers
 * without service worker support (old Safari/iOS versions, etc.) — this is
 * additive (PWA installability + static asset caching), never required for
 * the app to function.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("[pwa] service worker registration failed:", err);
    });
  }, []);

  return null;
}
