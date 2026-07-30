"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";
import { uploadGeneratedImage } from "@/lib/storage/upload-image";
import { extractShopeeUrl } from "@/lib/shopee/fetch-product-image";
import { resolveShopeeProductId } from "@/lib/shopee/resolve-product-id";
import { getSavedProductPhoto, saveProductPhoto } from "@/lib/shopee/product-photo-library";

export async function generatePost(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const topic = String(formData.get("topic") ?? "").trim();
  const rawPostType = formData.get("postType");
  const postType: "single" | "thread" | "carousel" =
    rawPostType === "thread" ? "thread" : rawPostType === "carousel" ? "carousel" : "single";
  const niche = String(formData.get("niche") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const imageDirection = String(formData.get("imageDirection") ?? "").trim();
  const wantsImage = formData.get("generateImage") === "on";
  const uploadedImageFile = formData.get("uploadedImage");
  const hasUploadedImage = uploadedImageFile instanceof File && uploadedImageFile.size > 0;

  // Carousel-only fields — ignored entirely unless postType is "carousel".
  const carouselImageFiles = formData
    .getAll("carouselImages")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const hasCarouselUploads = postType === "carousel" && carouselImageFiles.length > 0;
  const carouselImageCountRaw = Number(formData.get("carouselImageCount"));
  const carouselImageCount = Number.isFinite(carouselImageCountRaw)
    ? Math.min(10, Math.max(2, Math.round(carouselImageCountRaw)))
    : 3;

  if (!id) return;

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (postType === "carousel" && hasCarouselUploads && carouselImageFiles.length < 2) {
    redirect(
      `/dashboard/creators/${id}?error=${encodeURIComponent("A carousel needs at least 2 uploaded images")}`
    );
  }
  if (postType === "carousel" && carouselImageFiles.length > 20) {
    redirect(`/dashboard/creators/${id}?error=${encodeURIComponent("A carousel can have at most 20 images")}`);
  }

  let errorMessage: string | null = null;

  try {
    // Single/thread only: if the user both uploaded their own photo AND
    // checked "Generate image with AI", the upload becomes a REFERENCE
    // photo for Gemini (same mechanism as the Shopee auto-scrape — see
    // lib/shopee/fetch-product-image.ts) rather than the final image
    // outright, and it takes priority over auto-scraping since it's
    // guaranteed to actually be the right product. Upload without the
    // checkbox keeps the original behavior: used as-is, no AI call at all.
    const useUploadAsReference = postType !== "carousel" && wantsImage && hasUploadedImage;
    let referenceImageOverride: { buffer: Buffer; mimeType: string } | undefined;
    if (useUploadAsReference) {
      const file = uploadedImageFile as File;
      referenceImageOverride = {
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "image/jpeg"
      };
    }

    // "Give it once, reuse forever": if the Topic has a Shopee link, resolve
    // it to a stable product id (see lib/shopee/resolve-product-id.ts — this
    // just follows redirects, no browser rendering, so it isn't affected by
    // Shopee's anti-bot page-render block). If no fresh upload was given
    // this time but a photo was saved for this exact product before, use
    // that automatically — no re-upload needed, and it skips the live
    // auto-scrape entirely (which Shopee's bot detection frequently blocks
    // anyway — see fetch-product-image.ts) since we already have a known-
    // good photo on file.
    const shopeeUrl = postType !== "carousel" ? extractShopeeUrl(topic) : null;
    const shopeeProduct = shopeeUrl ? await resolveShopeeProductId(shopeeUrl) : null;

    if (!referenceImageOverride && wantsImage && shopeeProduct) {
      const saved = await getSavedProductPhoto(supabase, user.id, shopeeProduct.productId);
      if (saved) {
        try {
          const res = await fetch(saved.imageUrl);
          if (res.ok) {
            referenceImageOverride = {
              buffer: Buffer.from(await res.arrayBuffer()),
              mimeType: res.headers.get("content-type") || "image/jpeg"
            };
          }
        } catch {
          // Non-fatal — falls through to the live auto-scrape attempt
          // inside generateStyledPost instead.
        }
      }
    }

    const {
      posts,
      imageUrl: aiImageUrl,
      imageUrls: aiImageUrls,
      imageError: aiImageError,
      textAttachment
    } = await generateStyledPost({
      supabase,
      creatorId: id,
      topic: topic || undefined,
      postType,
      niche: niche || undefined,
      role: role || undefined,
      generateImage:
        postType === "carousel"
          ? wantsImage && !hasCarouselUploads
          : wantsImage && (!hasUploadedImage || useUploadAsReference),
      carouselImageCount,
      imageDirection: imageDirection || undefined,
      referenceImageOverride
    });

    // A fresh upload for a recognized Shopee product link gets remembered
    // for next time, regardless of whether the AI generation itself
    // succeeded — the point is the photo was genuinely the right product,
    // which is true independent of how the styled scene around it turned
    // out. Never fatal to the post if this fails.
    if (useUploadAsReference && shopeeProduct && referenceImageOverride) {
      try {
        await saveProductPhoto(
          supabase,
          user.id,
          shopeeProduct.productId,
          shopeeUrl ?? shopeeProduct.canonicalUrl,
          referenceImageOverride
        );
      } catch (err) {
        console.error("[generatePost] failed to save product photo to library:", err);
      }
    }

    let imageUrl: string | null = aiImageUrl;
    let imageUrls: string[] | null = aiImageUrls;
    let imageError = aiImageError;
    let uploadedImage = false;

    if (postType === "carousel" && hasCarouselUploads) {
      try {
        const urls: string[] = [];
        for (const file of carouselImageFiles) {
          const buffer = Buffer.from(await file.arrayBuffer());
          urls.push(await uploadGeneratedImage(buffer, file.type || "image/jpeg"));
        }
        imageUrls = urls;
        imageUrl = null;
        imageError = null;
        uploadedImage = true;
      } catch (err) {
        imageUrls = null;
        imageError = err instanceof Error ? err.message : "Image upload failed";
      }
    } else if (postType !== "carousel" && hasUploadedImage && !useUploadAsReference) {
      try {
        const file = uploadedImageFile as File;
        const buffer = Buffer.from(await file.arrayBuffer());
        imageUrl = await uploadGeneratedImage(buffer, file.type || "image/jpeg");
        imageError = null;
        uploadedImage = true;
      } catch (err) {
        imageUrl = null;
        imageError = err instanceof Error ? err.message : "Image upload failed";
      }
    }

    // A carousel draft with fewer than 2 images can't actually be published
    // as a carousel later — better to fail loudly now (with whatever
    // explanation is available) than save an unusable draft.
    if (postType === "carousel" && (!imageUrls || imageUrls.length < 2)) {
      errorMessage =
        imageError ?? "Carousel needs at least 2 images — upload some, or enable AI image generation.";
    } else {
      const { error: insertError } = await supabase.from("scheduled_posts").insert({
        user_id: user.id,
        creator_id: id,
        post_type: postType === "carousel" ? "carousel" : posts.length > 1 ? "thread" : "single",
        content_draft: posts,
        image_url: imageUrl,
        image_urls: imageUrls,
        image_error: imageError,
        uploaded_image: uploadedImage,
        text_attachment: textAttachment,
        // Kept so the "Spin" button on Drafts (app/dashboard/drafts/actions.ts,
        // spinDraft) can regenerate this same post later with the same
        // topic/niche/role, plus whatever extra direction the user adds then.
        topic: topic || null,
        niche: niche || null,
        role_prompt: role || null,
        image_direction: imageDirection || null,
        status: "draft"
      });

      if (insertError) {
        errorMessage = insertError.message;
      }
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Post generation failed";
  }

  revalidatePath(`/dashboard/creators/${id}`);
  revalidatePath("/dashboard/drafts");
  redirect(
    errorMessage
      ? `/dashboard/creators/${id}?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/drafts?message=${encodeURIComponent("New draft generated")}`
  );
}
