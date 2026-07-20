"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function saveThreadsSession(formData: FormData) {
  const raw = String(formData.get("sessionJson") ?? "").trim();

  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!raw) {
    redirect("/dashboard/settings?error=Paste%20the%20session%20JSON%20first");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    redirect(
      "/dashboard/settings?error=" +
        encodeURIComponent("That's not valid JSON — paste the full contents of threads-session-state.json")
    );
  }

  // Loose sanity check: a real Playwright storageState object has a
  // "cookies" array. Doesn't guarantee it's valid, but catches pasting the
  // wrong file entirely.
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as any).cookies)) {
    redirect(
      "/dashboard/settings?error=" +
        encodeURIComponent("That doesn't look like a Playwright session file (missing a \"cookies\" array)")
    );
  }

  const { error } = await supabase.from("user_settings").upsert({
    user_id: user.id,
    threads_session_state: parsed,
    threads_session_updated_at: new Date().toISOString()
  });

  if (error) {
    redirect(`/dashboard/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?message=Session%20saved");
}

export async function clearThreadsSession() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("user_settings")
    .update({ threads_session_state: null, threads_session_updated_at: null })
    .eq("user_id", user.id);

  if (error) {
    redirect(`/dashboard/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?message=Session%20cleared");
}
