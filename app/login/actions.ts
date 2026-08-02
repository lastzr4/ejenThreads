"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = createClient();
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(
    `/login?message=${encodeURIComponent(
      "Account created. If email confirmation is enabled in Supabase, check your inbox before signing in."
    )}`
  );
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Same sign-out as above, but with an explanatory message — used by
 * components/version-watcher.tsx when it detects a new deploy went live
 * while the tab was open (see lib/app-version.ts), rather than the plain
 * Sign out button click. Called directly from that client component (a
 * "use server" action can be invoked as a plain function from client code,
 * not just via a <form>), not through a form submission.
 */
export async function signOutForUpdate() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect(
    `/login?message=${encodeURIComponent(
      "CopyCreator telah dikemaskini — sila log masuk semula untuk dapatkan versi terkini."
    )}`
  );
}
