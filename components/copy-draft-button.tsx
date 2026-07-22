"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Client component because copying to the clipboard needs an onClick
 * handler — server components (the drafts page) can't attach one directly.
 */
export function CopyDraftButton({ posts, textAttachment }: { posts: string[]; textAttachment?: string | null }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const text = textAttachment
      ? [...posts, textAttachment].join("\n\n---\n\n")
      : posts.join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail on non-HTTPS/localhost edge cases — fail
      // silently rather than showing an alert for a low-stakes convenience button.
    }
  }

  return (
    <Button variant="outline" size="sm" type="button" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
