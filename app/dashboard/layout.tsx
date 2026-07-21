import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  // Defense in depth — middleware already redirects unauthenticated requests
  // away from /dashboard, but a Server Component check is cheap insurance.
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-semibold">CopyCreator</span>
          <nav className="flex items-center gap-4 text-sm text-slate-600">
            <Link href="/dashboard" className="hover:text-slate-900">
              Dashboard
            </Link>
            <Link href="/dashboard/creators" className="hover:text-slate-900">
              Creators
            </Link>
            <Link href="/dashboard/drafts" className="hover:text-slate-900">
              Drafts
            </Link>
            <Link href="/dashboard/schedules" className="hover:text-slate-900">
              Schedules
            </Link>
            <Link href="/dashboard/settings" className="hover:text-slate-900">
              Settings
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm text-slate-600">
          <span>{user.email}</span>
          <form action={signOut}>
            <Button variant="ghost" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
