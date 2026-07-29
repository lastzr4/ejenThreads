import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ImageGeneratorForm } from "@/components/image-generator-form";

export default function ImageGeneratorPage({
  searchParams
}: {
  searchParams: { imageUrl?: string; error?: string };
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Image Generator</h1>
        <p className="mt-1 text-sm text-slate-500">
          Generate a standalone image with Gemini — no post text, no creator style, just a prompt (or a
          template below) and an optional reference photo. Useful for grabbing an image on its own to reuse
          elsewhere, separate from the Generate post flow on a creator&apos;s page.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Generate</CardTitle>
          <CardDescription>Pick a template to start, edit it, then generate.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImageGeneratorForm />
          {searchParams?.error && <p className="mt-3 text-sm text-red-600">{searchParams.error}</p>}
        </CardContent>
      </Card>

      {searchParams?.imageUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
            <CardDescription>Right-click / long-press the image to save it, or use the link below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={searchParams.imageUrl}
              alt="Generated"
              className="max-h-[32rem] w-full rounded-md border border-slate-100 object-contain bg-slate-50"
            />
            <a
              href={searchParams.imageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-xs text-slate-500 hover:underline"
            >
              {searchParams.imageUrl}
            </a>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
