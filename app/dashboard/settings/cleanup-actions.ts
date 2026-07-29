"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Every AI-generated AND manually-uploaded image (Generate post, Schedules,
// the Image Generator tab) lands in this one shared Supabase Storage
// bucket via lib/storage/upload-image.ts — nothing ever deletes from it on
// its own, so it only grows: every regenerated draft, every "Spin", every
// standalone Image Generator result leaves its old file behind even after
// nothing references it anymore. This is a manual maintenance action to
// reclaim that.

const BUCKET = "generated-images";

function extractFilename(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.split("/").pop() || null;
  } catch {
    return null;
  }
}

/**
 * Deletes every file in the generated-images bucket that isn't referenced
 * by ANY scheduled_posts.image_url/image_urls or posting_schedules.
 * fixed_image_url/fixed_image_urls row — across ALL users, since the
 * bucket is shared/global rather than per-user, so a cleanup scoped to just
 * the current user's own rows could delete a file someone else's draft or
 * schedule still points at. Uses the admin client for exactly that reason
 * (needs to see every user's rows, not just the caller's — same
 * justification as the cron scheduler's use of it).
 */
export async function cleanupUnusedGeneratedImages() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  let deletedCount = 0;
  let keptCount = 0;
  let errorMessage: string | null = null;

  try {
    const [postsRes, schedulesRes] = await Promise.all([
      admin.from("scheduled_posts").select("image_url, image_urls"),
      admin.from("posting_schedules").select("fixed_image_url, fixed_image_urls")
    ]);
    if (postsRes.error) throw new Error(postsRes.error.message);
    if (schedulesRes.error) throw new Error(schedulesRes.error.message);

    const inUse = new Set<string>();
    const addUrl = (u: unknown) => {
      const f = extractFilename(typeof u === "string" ? u : null);
      if (f) inUse.add(f);
    };
    for (const row of postsRes.data ?? []) {
      addUrl(row.image_url);
      if (Array.isArray(row.image_urls)) row.image_urls.forEach(addUrl);
    }
    for (const row of schedulesRes.data ?? []) {
      addUrl(row.fixed_image_url);
      if (Array.isArray(row.fixed_image_urls)) row.fixed_image_urls.forEach(addUrl);
    }

    // List every file in the bucket, paginating past Supabase's default
    // page size until a page comes back short of the requested size.
    const allFiles: string[] = [];
    let offset = 0;
    const pageSize = 1000;
    for (;;) {
      const { data: page, error } = await admin.storage.from(BUCKET).list("", {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" }
      });
      if (error) throw new Error(error.message);
      for (const f of page ?? []) {
        if (f.name) allFiles.push(f.name);
      }
      if (!page || page.length < pageSize) break;
      offset += pageSize;
    }

    const unused = allFiles.filter((name) => !inUse.has(name));
    keptCount = allFiles.length - unused.length;

    // Storage remove() is chunked to stay well under any implicit batch
    // limits rather than sending a single huge array.
    const CHUNK = 100;
    for (let i = 0; i < unused.length; i += CHUNK) {
      const chunk = unused.slice(i, i + CHUNK);
      const { error } = await admin.storage.from(BUCKET).remove(chunk);
      if (error) throw new Error(error.message);
      deletedCount += chunk.length;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Cleanup failed";
  }

  revalidatePath("/dashboard/settings");
  redirect(
    errorMessage
      ? `/dashboard/settings?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/settings?message=${encodeURIComponent(
          `Cleaned up ${deletedCount} unused image${deletedCount === 1 ? "" : "s"} (${keptCount} still in use, kept)`
        )}`
  );
}
