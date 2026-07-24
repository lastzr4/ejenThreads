"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateStyledPost } from "@/lib/generation/generate-styled-post";
import { uploadGeneratedImage } from "@/lib/storage/upload-image";

export async function generatePost(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const topic = String(formData.get("topic") ?? "").trim();
  const rawPostType = formData.get("postType");
  const postType: "single" | "thread" | "carousel" =
    rawPostType === "thread" ? "thread" : rawPostType === "carousel" ? "carousel" : "single";
  const niche = String(formData.get("niche") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
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
    // A user-uploaded image always takes priority over AI generation — no
    // point spending a Gemini call for an image that's about to be
    // overridden anyway. For carousel, that means skipping AI generation
    // entirely if images were uploaded for it.
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
        postType === "carousel" ? wantsImage && !hasCarouselUploads : wantsImage && !hasUploadedImage,
      carouselImageCount
    });

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
    } else if (postType !== "carousel" && hasUploadedImage) {
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
