"use client";

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { generateStandaloneImage } from "@/app/dashboard/image-generator/actions";
import { SubmitButton } from "@/components/submit-button";
import { PendingBanner } from "@/components/pending-banner";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IMAGE_TEMPLATES } from "@/lib/image-templates";

/**
 * The prompt textarea is controlled (not just defaultValue) so clicking a
 * template button can overwrite it after the user has already typed
 * something — a plain uncontrolled textarea with defaultValue only applies
 * on first render.
 *
 * Reference photos support multiple files with per-file removal, which a
 * plain <input type="file" multiple> can't do on its own (no way to drop
 * one file from an already-chosen FileList). Selected files are kept in
 * React state for the preview thumbnails, and mirrored onto the actual
 * <input>'s FileList via a DataTransfer object (syncInputFiles) every time
 * the list changes — the server action reads formData.getAll("referenceImages")
 * from that real input at submit time, so it has to stay in sync, not just
 * the on-screen preview.
 */
export function ImageGeneratorForm() {
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const previewUrls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);

  const syncInputFiles = (next: File[]) => {
    const dt = new DataTransfer();
    next.forEach((f) => dt.items.add(f));
    if (inputRef.current) inputRef.current.files = dt.files;
  };

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;
    const next = [...files, ...selected];
    setFiles(next);
    syncInputFiles(next);
  };

  const removeFile = (index: number) => {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    syncInputFiles(next);
  };

  return (
    <form action={generateStandaloneImage} className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">Templat prompt (klik untuk isi, boleh edit)</p>
        <div className="flex flex-wrap gap-2">
          {IMAGE_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPrompt(t.prompt)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400 hover:text-slate-900"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="imagePrompt" className="mb-1 block text-xs font-medium text-slate-600">
          Prompt
        </Label>
        <Textarea
          id="imagePrompt"
          name="prompt"
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Klik satu templat di atas untuk mula, atau tulis prompt sendiri"
        />
      </div>

      <div>
        <Label htmlFor="referenceImages" className="mb-1 block text-xs font-medium text-slate-600">
          Gambar rujukan produk (optional, boleh lebih dari satu) — kalau ada, AI kekalkan rupa produk
          sebenar (bentuk/warna/label) dan bina scene sekitar dia based on prompt di atas, bukan reka produk
          dari kosong
        </Label>
        <input
          id="referenceImages"
          ref={inputRef}
          type="file"
          name="referenceImages"
          accept="image/*"
          multiple
          onChange={handleFilesSelected}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        {files.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {files.map((file, i) => (
              <div key={`${file.name}-${i}`} className="group relative h-16 w-16">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrls[i]}
                  alt={file.name}
                  className="h-16 w-16 rounded-md border border-slate-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  aria-label={`Remove ${file.name}`}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow hover:bg-red-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <SubmitButton pendingText="Generating…">Generate gambar</SubmitButton>
      <PendingBanner message="Gemini generating your image — usually takes a few seconds, longer if reference photos are attached." />
    </form>
  );
}
