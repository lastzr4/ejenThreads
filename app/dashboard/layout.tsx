import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { DashboardNav } from "@/components/dashboard-nav";
import { AvatarImage } from "@/components/avatar-image";
import { VersionWatcher } from "@/components/version-watcher";
import { APP_VERSION } from "@/lib/app-version";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  // getSession() reads the already-verified session straight from the
  // cookie (no network call) instead of getUser(), which re-checks with
  // Supabase's Auth server every time. Middleware (lib/supabase/middleware.ts)
  // already does that server-verified getUser() check on every request and
  // redirects unauthenticated ones away from /dashboard before this layout
  // even runs — this is just cheap defense-in-depth + reading the user's
  // email for display, so it doesn't need its own second network round
  // trip. Previously this ran getUser() again here too, meaning every
  // dashboard navigation paid for two sequential Auth API calls before any
  // page-specific data even started loading — a real chunk of the
  // "switching tabs feels laggy" delay.
  const {
    data: { session }
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  if (!user) {
    redirect("/login");
  }

  // Shown next to Sign out on every dashboard page — not just Settings — so
  // it's never ambiguous which real Threads account auto-posting, Auto-
  // Comment, and Schedules are about to publish to while you're off in
  // Creators/Drafts/Schedules, not just when you happen to be on Settings.
  const { data: threadsAccount } = await supabase
    .from("user_settings")
    .select("threads_api_username, threads_api_profile_picture_url")
    .eq("user_id", user.id)
    .maybeSingle();
  const threadsUsername = threadsAccount?.threads_api_username as string | null;
  const threadsAvatar = threadsAccount?.threads_api_profile_picture_url as string | null;

  return (
    <div className="min-h-screen bg-slate-50">
      <VersionWatcher initialVersion={APP_VERSION} />
      <header className="relative flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center gap-6">
          <span className="font-semibold">CopyCreator</span>
          <DashboardNav />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600 sm:gap-4">
          <Link
            href="/dashboard/settings"
            className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1.5 pr-2.5 text-xs hover:border-slate-300"
            title="Posts, replies, and schedules publish to this Threads account"
          >
            {threadsUsername ? (
              <>
                <AvatarImage
                  src={threadsAvatar}
                  alt={threadsUsername}
                  imgClassName="h-5 w-5 rounded-full object-cover"
                  fallbackClassName="flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-[10px] text-slate-500"
                />
                <span className="font-medium text-slate-700">@{threadsUsername}</span>
              </>
            ) : (
              <span className="text-amber-700">Threads not connected</span>
            )}
          </Link>
          <span className="hidden sm:inline">{user.email}</span>
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
