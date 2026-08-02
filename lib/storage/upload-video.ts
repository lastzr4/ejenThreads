import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "generated-videos";

/**
 * Uploads a video to the public "generated-videos" Supabase Storage bucket
 * (created in migration 0012) and returns its public URL — same pattern as
 * lib/storage/upload-image.ts's uploadGeneratedImage, just a separate
 * bucket since videos are a different content type/size class.
 *
 * Always uses the service-role admin client, regardless of which client the
 * caller is otherwise using — keeps storage writes simple and avoids
 * needing storage RLS policies for authenticated uploads. The bucket itself
 * being public is what makes the resulting URL fetchable by Threads
 * (graph.threads.net requires video_url to be a publicly reachable address
 * at publish time), not the write access.
 */
export async function uploadGeneratedVideo(buffer: Buffer, contentType: string): Promise<string> {
  const supabase = createAdminClient();
  const extension = contentType === "video/quicktime" ? "mov" : "mp4";
  const path = `${randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false
  });

  if (error) {
    throw new Error(`Failed to upload video: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
