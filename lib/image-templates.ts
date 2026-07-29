// Predefined prompt starting points for the standalone Image Generator tab
// (Dashboard → Image Generator). Each fills the prompt textarea when
// clicked — the user is expected to edit the bracketed placeholder before
// generating, not use it verbatim. Kept separate from the post-generation
// prompts in lib/generation/generate-styled-post.ts since this tool has no
// creator style profile or post text involved, just a raw image prompt.

export interface ImageTemplate {
  id: string;
  label: string;
  prompt: string;
}

export const IMAGE_TEMPLATES: ImageTemplate[] = [
  {
    id: "product-lifestyle",
    label: "Produk Fizikal / Botol / Aksesori (Lifestyle Casual)",
    prompt:
      "A casual, everyday lifestyle photo featuring [describe your product, e.g. a skincare serum bottle] " +
      "naturally placed in a relatable setting — a cozy bedroom vanity, kitchen counter, or bag flatlay. " +
      "Soft natural window light, warm inviting tones, slightly candid framing (not overly staged), " +
      "photorealistic, optimized for high engagement on social media."
  },
  {
    id: "ootd",
    label: "Pakaian / OOTD (Outfit Of The Day)",
    prompt:
      "A trendy Outfit-Of-The-Day (OOTD) photo featuring [describe the outfit/item] worn by a model in an " +
      "urban outdoor setting — street style, a cafe exterior, or an aesthetic wall backdrop. Natural " +
      "daylight, confident candid pose, vibrant but tasteful color grading, Instagram-fashion-blogger " +
      "aesthetic, full-body or three-quarter framing, photorealistic."
  },
  {
    id: "home-minimalist",
    label: "Barangan Rumah / Dekorasi / Gadget (Minimalist Home Vibe)",
    prompt:
      "A minimalist home lifestyle photo featuring [describe the item] styled in a clean, modern interior " +
      "space — neutral color palette (white, beige, wood tones), soft natural light from a nearby window, " +
      "uncluttered composition with a few complementary props, cozy and aspirational aesthetic, " +
      "photorealistic."
  }
];
