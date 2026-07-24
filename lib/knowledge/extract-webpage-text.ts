// Lightweight, dependency-free HTML → plain text extraction for the
// "paste a URL" knowledge base option (app/dashboard/creators/knowledge-
// actions.ts) — the extracted text is used exactly the same way as
// PDF-extracted text in lib/generation/generate-styled-post.ts. This is
// NOT a full Readability-style article parser (no separating "main
// content" from a sidebar, for instance) — just strips obvious noise
// (script/style/nav/header/footer), removes tags, and decodes entities.
// Good enough to hand Claude usable reference material without pulling in
// an HTML-parsing dependency for it, matching this codebase's existing
// preference for plain fetch-based, dependency-light external I/O (see
// lib/gemini/generate-image.ts, lib/threads/publish.ts).

const MAX_HTML_BYTES = 3_000_000; // 3MB — plenty for an article page; guards against buffering a pathologically large response fully into memory

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“"
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (match: string, name: string) => ENTITY_MAP[name] ?? match);
}

export interface ExtractedWebpage {
  title: string | null;
  text: string;
}

/**
 * Fetches a URL and returns its readable text. Throws a plain Error with a
 * user-facing message on any failure (bad URL, timeout, non-HTML content,
 * no readable text) — same contract as the PDF-parsing path this pairs
 * with in knowledge-actions.ts.
 */
export async function extractWebpageText(url: string): Promise<ExtractedWebpage> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("That doesn't look like a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CopyCreatorBot/1.0; knowledge-base-fetch)",
        Accept: "text/html,application/xhtml+xml"
      }
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The page took too long to respond (15s timeout)");
    }
    throw new Error(`Failed to fetch that URL: ${err instanceof Error ? err.message : "unknown error"}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`That page returned an error (HTTP ${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error(
      `That URL isn't a webpage CopyCreator can read (content-type: ${contentType || "unknown"}) — only ` +
        `HTML pages are supported, not PDFs or other file types.`
    );
  }

  const buffer = await res.arrayBuffer();
  const html = Buffer.from(buffer.slice(0, MAX_HTML_BYTES)).toString("utf-8");

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().replace(/\s+/g, " ") : null;

  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const withoutTags = withoutNoise.replace(/<[^>]+>/g, " ");
  const decoded = decodeEntities(withoutTags);
  const text = decoded
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

  if (!text) {
    throw new Error("Couldn't find any readable text on that page");
  }

  return { title, text };
}
