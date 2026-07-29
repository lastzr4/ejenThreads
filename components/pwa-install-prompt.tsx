"use client";

import { useEffect, useState } from "react";

// Chrome/Android normally only shows its own install prompt after its own
// engagement heuristics are met (a handful of visits over time) — most
// people would never see it. This mounts a "beforeinstallprompt" listener
// (see MDN) so we can trigger that same native popup ourselves, on the
// FIRST visit, via our own button — forcing the popup the user asked for
// instead of waiting on Chrome's own timing. iOS Safari has no such event
// at all (Apple's deliberate platform limitation, not a bug here) — it can
// only ever be installed through the Share sheet, so on iOS this shows a
// small instruction banner instead of a clickable install button.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "cc-pwa-install-dismissed";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own (non-standard) flag for "already added to home screen"
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosBanner, setShowIosBanner] = useState(false);
  const [dismissed, setDismissed] = useState(true); // default true so nothing flashes before the effect runs

  useEffect(() => {
    if (isStandalone()) return; // already installed — never show anything

    setDismissed(sessionStorage.getItem(DISMISSED_KEY) === "1");

    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS never fires beforeinstallprompt — show the manual instructions
    // banner instead, since that's the only install path Apple allows.
    if (isIos()) setShowIosBanner(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISSED_KEY, "1");
  };

  const install = async () => {
    if (!deferredEvent) return;
    await deferredEvent.prompt();
    await deferredEvent.userChoice;
    setDeferredEvent(null);
  };

  if (dismissed || (!deferredEvent && !showIosBanner)) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-lg sm:inset-x-auto sm:right-4 sm:w-80">
      <div className="text-xs text-slate-700">
        <p className="font-medium text-slate-900">Install CopyCreator</p>
        {deferredEvent ? (
          <p className="mt-0.5">Add it to your home screen for a full-screen, app-like experience.</p>
        ) : (
          <p className="mt-0.5">
            Tap the Share icon <span aria-hidden>⬆️</span>, then &quot;Add to Home Screen&quot;.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {deferredEvent && (
          <button
            type="button"
            onClick={install}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            Install
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md px-2 py-1.5 text-xs text-slate-400 hover:text-slate-600"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
