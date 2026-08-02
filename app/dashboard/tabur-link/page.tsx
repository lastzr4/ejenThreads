import { createClient } from "@/lib/supabase/server";
import { generateTaburLinkPost } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { PendingBanner } from "@/components/pending-banner";
import { NICHE_OPTIONS } from "@/lib/niches";
import { HOOK_TYPE_OPTIONS } from "@/lib/hook-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function TaburLinkPage({
  searchParams
}: {
  searchParams: { error?: string; message?: string };
}) {
  const supabase = createClient();

  const [{ data: creators }, { data: analyzedRows }] = await Promise.all([
    supabase.from("creators").select("id, username").order("username"),
    supabase.from("creator_analysis").select("creator_id")
  ]);

  const analyzedCreatorIds = new Set((analyzedRows ?? []).map((r) => r.creator_id));
  const studiedCreators = (creators ?? []).filter((c) => analyzedCreatorIds.has(c.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tabur Link</h1>
        <p className="mt-1 text-sm text-slate-500">
          Paste a Shopee affiliate link, pair it with a real video or photo, and get back an AI-styled
          caption — saved to Drafts for you to review before it goes out, same as everywhere else.
        </p>
        <div className="mt-3 rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
          <p className="font-medium">About the video field:</p>
          <p>
            This app does not auto-download videos from Shopee or anywhere else — that runs into both
            Shopee&apos;s anti-bot blocking (same issue as product photos) and a real rights question, since
            the video belongs to the seller/original creator. The safe, sanctioned source is Shopee&apos;s
            own <strong>Affiliate Center</strong> (or Involve Asia, if that&apos;s how your affiliate account
            is set up) — sellers who opt in provide creative assets there explicitly for affiliates to reuse.
            Download it from there, then upload it below.
          </p>
        </div>
        {searchParams?.error && <p className="mt-2 text-sm text-red-600">{searchParams.error}</p>}
        {searchParams?.message && <p className="mt-2 text-sm text-green-600">{searchParams.message}</p>}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate a Tabur Link post</CardTitle>
          <CardDescription>
            Only creators you&apos;ve Studied show up here — that&apos;s what supplies the writing style.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {studiedCreators.length === 0 ? (
            <p className="text-sm text-slate-500">
              No studied creators yet — go to a creator&apos;s page, fetch posts, then click Study.
            </p>
          ) : (
            <form action={generateTaburLinkPost} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Creator (style)</label>
                  <select
                    name="creatorId"
                    required
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                  >
                    {studiedCreators.map((c) => (
                      <option key={c.id} value={c.id}>
                        @{c.username}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Niche (optional)</label>
                  <select
                    name="niche"
                    defaultValue="affiliate_product"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                  >
                    {NICHE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Shopee affiliate link</label>
                <input
                  type="text"
                  name="shopeeUrl"
                  required
                  placeholder="https://s.shopee.com.my/..."
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Role / arahan khusus (optional)
                </label>
                <textarea
                  name="role"
                  rows={2}
                  placeholder="Leave blank to just use this creator's usual post format"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Jenis Hook (optional) — pick one or more; AI blends them naturally into the opening
                </label>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-3">
                  {HOOK_TYPE_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <input type="checkbox" name="hookTypes" value={opt.value} className="rounded border-slate-300" />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-md border border-slate-100 bg-slate-50 p-3 space-y-1">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Video (a creative asset you downloaded from Shopee&apos;s Affiliate Center — MP4 or MOV,
                  under 100MB)
                </label>
                <input
                  type="file"
                  name="video"
                  accept="video/mp4,video/quicktime"
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                or, if you don&apos;t have a video for this link
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Upload your own photo (optional) — used as-is if &quot;Generate image with AI&quot; below
                  is OFF; if that&apos;s ON too, it becomes a reference photo instead (AI keeps the real
                  product accurate but builds a fresh, more engaging scene around it)
                </label>
                <input
                  type="file"
                  name="uploadedImage"
                  accept="image/*"
                  className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" name="generateImage" className="rounded border-slate-300" />
                  Generate image with AI (Gemini — ignored if a video is uploaded above)
                </label>
                <SubmitButton pendingText="Generating…">Generate post</SubmitButton>
              </div>
              <PendingBanner message="Writing your caption with Claude, and uploading the video/image — can take a little longer for larger videos. This new draft will show up on the Drafts page when it's done." />
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
