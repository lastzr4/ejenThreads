"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveShopeeProductId } from "@/lib/shopee/resolve-product-id";
import { saveProductPhoto } from "@/lib/shopee/product-photo-library";

/**
 * Lets a photo be registered for a Shopee product ahead of time — "give me
 * the link and photo in advance" — rather than only being capturable as a
 * side effect of generating a post with both provided together. Same
 * underlying library (shopee_product_photos) either way; this is just a
 * second entry point into it.
 */
export async function addProductPhoto(formData: FormData) {
  const shopeeUrl = String(formData.get("shopeeUrl") ?? "").trim();
  const photoFile = formData.get("photo");
  const hasPhoto = photoFile instanceof File && photoFile.size > 0;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!shopeeUrl || !hasPhoto) {
    redirect(`/dashboard/settings?error=${encodeURIComponent("Perlukan link Shopee DAN gambar")}`);
  }

  try {
    const resolved = await resolveShopeeProductId(shopeeUrl);
    if (!resolved) {
      redirect(
        `/dashboard/settings?error=${encodeURIComponent("Tak dapat kenal pasti produk dari link tu — pastikan ia link Shopee yang sah")}`
      );
    }

    const file = photoFile as File;
    await saveProductPhoto(supabase, user.id, resolved.productId, shopeeUrl, {
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || "image/jpeg"
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save product photo";
    redirect(`/dashboard/settings?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/settings");
  redirect(`/dashboard/settings?message=${encodeURIComponent("Product photo saved")}`);
}

export async function deleteProductPhoto(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("shopee_product_photos").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    redirect(`/dashboard/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/settings");
  redirect(`/dashboard/settings?message=${encodeURIComponent("Product photo removed")}`);
}
