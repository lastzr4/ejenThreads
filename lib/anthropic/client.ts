import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local (and Railway → Variables) to use the AI style analyzer / generator."
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

// Keep the model name in one place so Module 3 (generation) can reuse it.
// claude-sonnet-5 is a good default for style analysis — swap to
// claude-opus-4-8 if you want higher-effort analysis on more expensive
// per-token pricing.
export const ANTHROPIC_MODEL = "claude-sonnet-5";
