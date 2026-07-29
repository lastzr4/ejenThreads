"use client";

import { useState } from "react";
import { generateStandaloneImage } from "@/app/dashboard/image-generator/actions";
import { SubmitButton } from "@/components/submit-button";
import { PendingBanner } from "@/components/pending-banner";
import { IMAGE_TEMPLATES } from "@/lib/image-templates";

/**
 * The prompt textarea is controlled (not just defaultValue) so clicking a
 * template button can overwrite it after the user has already typed
 * something — a plain uncontrolled textarea with defaultValue only applies
 * on first render.
 */
export function ImageGeneratorForm() {
  const [prompt, setPrompt] = useState("");

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
        <label className="mb-1 block text-xs font-medium text-slate-600">Prompt</label>
        <textarea
          name="prompt"
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Klik satu templat di atas untuk mula, atau tulis prompt sendiri"
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          Gambar rujukan produk (optional) — kalau ada, AI kekalkan rupa produk sebenar (bentuk/warna/label)
          dan bina scene sekitar dia based on prompt di atas, bukan reka produk dari kosong
        </label>
        <input
          type="file"
          name="referenceImage"
          accept="image/*"
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
      </div>

      <SubmitButton pendingText="Generating…">Generate gambar</SubmitButton>
      <PendingBanner message="Gemini generating your image — usually takes a few seconds, longer if a reference photo is attached." />
    </form>
  );
}
