import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { uploadGeneratedImage } from "@/lib/storage/upload-image";

// The "give it once, reuse forever" half of the product-photo-reference
// feature — see lib/shopee/resolve-product-id.ts for how a Shopee link
// becomes the stable productId used as the lookup key here.

export interface SavedProductPhoto {
  imageUrl: string;
  title: string | null;
}

/** Looks up a previously-saved real product photo for this user + product, if any. */
export async function getSavedProductPhoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  userId: string,
  productId: string
): Promise<SavedProductPhoto | null> {
  const { data } = await supabase
    .from("shopee_product_photos")
    .select("image_url, title")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  return data ? { imageUrl: data.image_url as string, title: (data.title as string | null) ?? null } : null;
}

/**
 * Uploads the given photo bytes to Storage and remembers it for this
 * user+product going forward (upsert — a newer photo for the same product
 * replaces the old one rather than erroring on the unique constraint).
 */
export async function saveProductPhoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<Database> | SupabaseClient<any>,
  userId: string,
  productId: string,
  sourceUrl: string,
  photo: { buffer: Buffer; mimeType: string },
  title?: string | null
): Promise<void> {
  const imageUrl = await uploadGeneratedImage(photo.buffer, photo.mimeType);

  await supabase.from("shopee_product_photos").upsert(
    {
      user_id: userId,
      product_id: productId,
      source_url: sourceUrl,
      image_url: imageUrl,
      title: title ?? null
    },
    { onConflict: "user_id,product_id" }
  );
}
