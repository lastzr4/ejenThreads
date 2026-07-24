"use client";

import { useFormStatus } from "react-dom";

/**
 * Inline "this is working, don't worry" message shown only while its parent
 * <form>'s server action is running (useFormStatus reads the nearest
 * parent form, so this must be rendered as a form child, same constraint as
 * SubmitButton). Generate post / Study / Fetch posts all call slow external
 * APIs (Claude, Gemini image gen, Playwright scraping) that can genuinely
 * take 5-30+ seconds — the button's own pending spinner (SubmitButton)
 * already shows it's working, but a plain disabled button with no
 * explanation reads as "stuck/laggy" rather than "busy for a good reason".
 * This adds the missing context without changing the actual latency.
 */
export function PendingBanner({ message }: { message: string }) {
  const { pending } = useFormStatus();

  if (!pending) return null;

  return (
    <p className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
      />
      {message}
    </p>
  );
}
