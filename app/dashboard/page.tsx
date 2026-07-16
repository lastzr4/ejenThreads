import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-sm text-slate-500">
        Module 1 is live — add Threads creators to track and pull their
        recent posts.
      </p>
      <Link href="/dashboard/creators" className="mt-4 inline-block">
        <Button>Go to Creators</Button>
      </Link>
    </div>
  );
}
