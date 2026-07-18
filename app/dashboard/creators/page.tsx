import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { addCreator, deleteCreator } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function CreatorsPage({
  searchParams
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();
  const { data: creators, error } = await supabase
    .from("creators")
    .select("id, username, display_name, last_scraped_at, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Creators</h1>
        <p className="mt-1 text-sm text-slate-500">
          Threads accounts you&apos;re studying. Add a username, then open a
          creator to pull their recent posts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a creator</CardTitle>
          <CardDescription>Enter a Threads username (with or without the @).</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={addCreator} className="flex items-end gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" name="username" placeholder="zuck" required />
            </div>
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </form>
          {(searchParams?.error || error) && (
            <p className="mt-3 text-sm text-red-600">{searchParams?.error ?? error?.message}</p>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {creators && creators.length > 0 ? (
          creators.map((creator) => (
            <Card key={creator.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <Link
                    href={`/dashboard/creators/${creator.id}`}
                    className="font-medium hover:underline"
                  >
                    @{creator.username}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {creator.last_scraped_at
                      ? `Last scraped ${new Date(creator.last_scraped_at).toLocaleString()}`
                      : "Not scraped yet"}
                  </p>
                </div>
                <form action={deleteCreator}>
                  <input type="hidden" name="id" value={creator.id} />
                  <SubmitButton variant="ghost" size="sm" pendingText="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-slate-500">No creators tracked yet.</p>
        )}
      </div>
    </div>
  );
}
