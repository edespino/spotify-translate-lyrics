import { GoogleGenAI } from "@google/genai";
import type { TrackMeta, TranslationProvider } from "./types";
import { parseTranslationResponse } from "./validate";

const MODEL = "gemini-2.5-flash";

function buildPrompt(lines: string[], meta: TrackMeta): string {
  return [
    `Translate these Spanish song lyrics to English. The song is "${meta.title}" by ${meta.artist}.`,
    "Translate idiomatically, preserving tone and meaning, not word for word.",
    `There are exactly ${lines.length} lines. Output exactly ${lines.length} lines in the same order.`,
    "Keep empty lines empty. Do not merge, split, or reorder lines.",
    "Output ONLY a JSON array of strings, one per input line. No other text.",
    "",
    "Lyrics (JSON array):",
    JSON.stringify(lines),
  ].join("\n");
}

export class GeminiProvider implements TranslationProvider {
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async translate(lines: string[], meta: TrackMeta): Promise<string[]> {
    const response = await this.client.models.generateContent({
      model: MODEL,
      contents: buildPrompt(lines, meta),
      config: { responseMimeType: "application/json" },
    });
    return parseTranslationResponse(response.text ?? "", lines.length);
  }
}

// Runs the provider with the line-count contract: on a bad result,
// retry the whole batch once, then fall back to line-by-line calls.
// A line whose individual call also fails keeps its original text.
export async function translateLines(
  provider: TranslationProvider,
  lines: string[],
  meta: TrackMeta
): Promise<string[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await provider.translate(lines, meta);
      if (result.length === lines.length) return result;
    } catch {
      // fall through to retry or fallback
    }
  }
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      out.push("");
      continue;
    }
    try {
      const single = await provider.translate([line], meta);
      out.push(single.length === 1 ? single[0] : line);
    } catch {
      out.push(line);
    }
  }
  return out;
}
