"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function deleteDraft(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = createClient();
  const { error } = await supabase.from("scheduled_posts").delete().eq("id", id);

  if (error) {
    redirect(`/dashboard/drafts?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/drafts");
  redirect("/dashboard/drafts");
}
