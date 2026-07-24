"use client";

import { useState } from "react";
import { spinDraft } from "@/app/dashboard/drafts/actions";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";

interface SpinDraftFormProps {
  id: string;
}

/**
 * "Spin" — regenerates this draft's text with the same creator style/topic/
 * niche/role it was originally written with, optionally steered by an
 * extra comment (e.g. "buat lebih lucu", "tambah statistik", "fokus pada
 * masalah X"). The image (if any) stays as-is — only the copy gets a fresh
 * rewrite. Toggles between a plain button and an inline comment form, same
 * pattern as EditDraftForm.
 */
export function SpinDraftForm({ id }: SpinDraftFormProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)}>
        Spin
      </Button>
    );
  }

  return (
    <form
      action={spinDraft}
      className="w-full space-y-2 rounded-md border border-slate-200 bg-white p-3"
    >
      <input type="hidden" name="id" value={id} />
      <label className="mb-1 block text-xs font-medium text-slate-600">
        Extra direction (optional) — e.g. &quot;buat lebih lucu&quot;, &quot;tambah statistik&quot;,
        &quot;fokus pada masalah X&quot;. The image stays the same — only the text gets rewritten.
      </label>
      <textarea
        name="comment"
        rows={2}
        placeholder="Leave blank to just get a fresh rewrite in the same style"
        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
      />
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Spinning…">
          Spin
        </SubmitButton>
        <Button variant="ghost" size="sm" type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
