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

  // Deeper check: cookies alone (csrftoken, ig_did, mid, etc.) get set just
  // by loading the login page — they don't prove you're actually logged in.
  // The cookie that does is "sessionid" (Threads runs on Instagram's auth).
  // Without it, this "session" scrapes exactly like an anonymous visitor —
  // Threads shows ~4 posts then a "Log in to see more" wall, which looked
  // like a scraper bug but was actually an incomplete login capture. Catch
  // it here instead of only discovering it several fetches later.
  const cookies = (parsed as any).cookies as Array<Record<string, unknown>>;
  const hasSessionId = cookies.some(
    (c) =>
      c?.name === "sessionid" &&
      typeof c?.domain === "string" &&
      /threads\.(net|com)|instagram\.com/.test(c.domain as string)
  );
  if (!hasSessionId) {
    redirect(
      "/dashboard/settings?error=" +
        encodeURIComponent(
          "This session file has no \"sessionid\" cookie, which means the login wasn't actually completed " +
            "when it was captured (you'll still see only ~4 posts per creator). Re-run the .bat file, make " +
            "sure you land on your real Threads home feed before pressing Enter, then paste the new file."
        )
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

export async function disconnectThreadsApi() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("user_settings")
    .update({
      threads_api_user_id: null,
      threads_api_access_token: null,
      threads_api_token_expires_at: null,
      threads_api_connected_at: null
    })
    .eq("user_id", user.id);

  if (error) {
    redirect(`/dashboard/settings?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?message=Threads%20API%20disconnected");
}
