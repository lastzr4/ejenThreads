import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "generated-images";

/**
 * Uploads a generated image to the public "generated-images" Supabase
 * Storage bucket (created in migration 0005) and returns its public URL.
 *
 * Always uses the service-role admin client for this, regardless of which
 * client the caller is otherwise using (user-session or admin) — keeps
 * storage writes simple and consistent, and avoids needing storage RLS
 * policies for authenticated uploads. The bucket itself is what's public,
 * not the write access.
 */
export async function uploadGeneratedImage(buffer: Buffer, contentType: string): Promise<string> {
  const supabase = createAdminClient();
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const path = `${randomUUID()}.${extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType,
    upsert: false
  });

  if (error) {
    throw new Error(`Failed to upload generated image: ${error.message}`);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
