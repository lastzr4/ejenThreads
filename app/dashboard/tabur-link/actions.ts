"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";
import { uploadGeneratedImage } from "@/lib/storage/upload-image";
import { uploadGeneratedVideo } from "@/lib/storage/upload-video";
import { extractShopeeUrl } from "@/lib/shopee/fetch-product-image";
import { resolveShopeeProductId } from "@/lib/shopee/resolve-product-id";
import { getSavedProductPhoto, saveProductPhoto } from "@/lib/shopee/product-photo-library";

// App-level safety cap, well below Threads' own 1GB — this is meant for a
// short promo clip (a licensed creative asset from Shopee's Affiliate
// Center — see README), not a full-length video, and keeps Storage
// costs/egress sane.
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

/**
 * "Tabur Link" — paste a Shopee affiliate link, pair it with a real video
 * (deliberately NOT auto-scraped — see README for why: Shopee's anti-bot
 * wall plus the rights question of reposting someone else's video means
 * the reliable, safe path is a creative asset the user themselves sourced
 * from Shopee's own Affiliate Center, which sellers explicitly opt into
 * providing for reuse) or a photo, and get back an AI-styled caption ready
 * to review on Drafts. Always saved as a draft, never auto-published — same
 * "review before it goes out" default as the main Generate post flow,
 * extra warranted here since it's republishing someone else's media asset.
 */
export async function generateTaburLinkPost(formData: FormData) {
  const creatorId = String(formData.get("creatorId") ?? "");
  const shopeeUrl = String(formData.get("shopeeUrl") ?? "").trim();
  const niche = String(formData.get("niche") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const hookTypes = formData.getAll("hookTypes").map((v) => String(v));
  const wantsImage = formData.get("generateImage") === "on";

  const videoFile = formData.get("video");
  const hasVideo = videoFile instanceof File && videoFile.size > 0;
  const uploadedImageFile = formData.get("uploadedImage");
  const hasUploadedImage = uploadedImageFile instanceof File && uploadedImageFile.size > 0;

  if (!creatorId) {
    redirect(`/dashboard/tabur-link?error=${encodeURIComponent("Pick a creator whose style to use")}`);
  }
  if (!shopeeUrl) {
    redirect(`/dashboard/tabur-link?error=${encodeURIComponent("Paste a Shopee affiliate link")}`);
  }

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (hasVideo) {
    const file = videoFile as File;
    if (!ALLOWED_VIDEO_TYPES.has(file.type)) {
      redirect(
        `/dashboard/tabur-link?error=${encodeURIComponent("Video must be MP4 or MOV — Threads' supported formats")}`
      );
    }
    if (file.size > MAX_VIDEO_BYTES) {
      redirect(`/dashboard/tabur-link?error=${encodeURIComponent("Video is too large — keep it under 100MB")}`);
    }
  }

  let errorMessage: string | null = null;

  try {
    let videoUrl: string | null = null;
    let referenceImageOverride: { buffer: Buffer; mimeType: string } | undefined;

    if (hasVideo) {
      const file = videoFile as File;
      const buffer = Buffer.from(await file.arrayBuffer());
      videoUrl = await uploadGeneratedVideo(buffer, file.type || "video/mp4");
    } else if (hasUploadedImage) {
      const file = uploadedImageFile as File;
      referenceImageOverride = {
        buffer: Buffer.from(await file.arrayBuffer()),
        mimeType: file.type || "image/jpeg"
      };
    }

    // Same "give it once, reuse forever" product photo library as the main
    // Generate post flow (see app/dashboard/creators/generate-actions.ts) —
    // only relevant when there's no video and no fresh upload this time.
    const shopeeLink = extractShopeeUrl(shopeeUrl);
    const shopeeProduct = !hasVideo && shopeeLink ? await resolveShopeeProductId(shopeeLink) : null;

    if (!hasVideo && !referenceImageOverride && wantsImage && shopeeProduct) {
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
      imageError: aiImageError,
      textAttachment
    } = await generateStyledPost({
      supabase,
      creatorId,
      topic: shopeeUrl,
      postType: "single",
      niche: niche || undefined,
      role: role || undefined,
      hookTypes: hookTypes.length > 0 ? hookTypes : undefined,
      userId: user.id,
      // No image generation at all when a video is attached — the video IS
      // the visual. Otherwise same dual-mode as the main Generate post
      // flow: a fresh upload + the AI checkbox together become a reference
      // photo instead of the final image outright.
      generateImage: !hasVideo && wantsImage && (!hasUploadedImage || Boolean(referenceImageOverride)),
      referenceImageOverride
    });

    // A fresh upload for a recognized Shopee product link gets remembered
    // for next time, same as the main Generate post flow.
    if (!hasVideo && hasUploadedImage && shopeeProduct && referenceImageOverride) {
      try {
        await saveProductPhoto(
          supabase,
          user.id,
          shopeeProduct.productId,
          shopeeLink ?? shopeeProduct.canonicalUrl,
          referenceImageOverride
        );
      } catch (err) {
        console.error("[generateTaburLinkPost] failed to save product photo to library:", err);
      }
    }

    let imageUrl: string | null = hasVideo ? null : aiImageUrl;
    let imageError: string | null = hasVideo ? null : aiImageError;
    let uploadedImage = false;

    if (!hasVideo && hasUploadedImage && !referenceImageOverride) {
      // Upload without the AI checkbox — used as-is, same as the main flow.
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

    const { error: insertError } = await supabase.from("scheduled_posts").insert({
      user_id: user.id,
      creator_id: creatorId,
      post_type: posts.length > 1 ? "thread" : "single",
      content_draft: posts,
      image_url: imageUrl,
      video_url: videoUrl,
      image_error: imageError,
      uploaded_image: uploadedImage,
      text_attachment: textAttachment,
      topic: shopeeUrl,
      niche: niche || null,
      role_prompt: role || null,
      hook_types: hookTypes.length > 0 ? hookTypes : null,
      status: "draft"
    });

    if (insertError) {
      errorMessage = insertError.message;
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : "Post generation failed";
  }

  revalidatePath("/dashboard/tabur-link");
  revalidatePath("/dashboard/drafts");
  redirect(
    errorMessage
      ? `/dashboard/tabur-link?error=${encodeURIComponent(errorMessage)}`
      : `/dashboard/drafts?message=${encodeURIComponent("New Tabur Link draft generated")}`
  );
}
