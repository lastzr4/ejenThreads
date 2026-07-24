import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { DashboardNav } from "@/components/dashboard-nav";

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="relative flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="flex items-center gap-6">
          <span className="font-semibold">CopyCreator</span>
          <DashboardNav />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600 sm:gap-4">
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
