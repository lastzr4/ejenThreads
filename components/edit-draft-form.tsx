"use client";

import { useState } from "react";
import { updateDraftContent } from "@/app/dashboard/drafts/actions";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";

interface EditDraftFormProps {
  id: string;
  posts: string[];
  textAttachment: string | null;
}

/**
 * Toggles between the normal read-only display (posts + optional text
 * attachment, rendered by the caller) and an inline edit form — lets the
 * user fix a typo or reword something before clicking Publish, without
 * regenerating the whole draft. Only rendered for drafts that are still
 * editable (status "draft" or "pending_review"); the page decides that and
 * only mounts this when canEdit is true.
 */
export function EditDraftForm({ id, posts, textAttachment }: EditDraftFormProps) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          {posts.map((text, i) => (
            <p
              key={i}
              className="whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 p-3 text-sm"
            >
              {text}
            </p>
          ))}
        </div>
        {textAttachment && (
          <details className="rounded-md border border-slate-100 bg-slate-50 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">
              Full story (long-form attachment — shown as &quot;See more&quot; on the post)
            </summary>
            <p className="mt-2 whitespace-pre-wrap text-slate-600">{textAttachment}</p>
          </details>
        )}
        <Button variant="outline" size="sm" type="button" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    );
  }

  return (
    <form
      action={updateDraftContent}
      className="w-full space-y-2 rounded-md border border-slate-200 bg-white p-3"
    >
      <input type="hidden" name="id" value={id} />
      {posts.map((text, i) => (
        <div key={i}>
          {posts.length > 1 && (
            <label className="mb-1 block text-xs font-medium text-slate-600">Post {i + 1}</label>
          )}
          <textarea
            name="posts"
            defaultValue={text}
            rows={4}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
          />
        </div>
      ))}
      {textAttachment !== null && (
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Full story (long-form attachment)
          </label>
          <textarea
            name="textAttachment"
            defaultValue={textAttachment}
            rows={6}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">
          Save changes
        </SubmitButton>
        <Button variant="ghost" size="sm" type="button" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
