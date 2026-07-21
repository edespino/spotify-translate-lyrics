import { GoogleGenAI } from "@google/genai";
import type { GlossEntry, TrackMeta, TranslationProvider } from "./types";
import {
  GlossShapeError,
  parseGlossResponse,
  parseTranslationResponse,
  validateGlossEntry,
} from "./validate";

export const DEFAULT_MODEL = "gemini-flash-lite-latest";

// Chunk size for the fallback path. Big enough that a typical song
// needs only a handful of requests, small enough that the model can
// hold the exact line count.
const CHUNK_SIZE = 20;

// Rate-limit retry policy per provider call: the initial attempt plus
// this many retries, waiting between attempts.
const MAX_RATE_LIMIT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 15000;
const MAX_RETRY_DELAY_MS = 60000;

// Thrown when translation cannot be completed. The server must treat
// this as a hard failure: return an error and cache nothing. Original
// Spanish text must never be passed off as an English translation.
export class TranslationFailedError extends Error {}

function buildPrompt(lines: string[], meta: TrackMeta): string {
  return [
    `Translate these Spanish song lyrics to English. The song is "${meta.title}" by ${meta.artist}.`,
    "Translate idiomatically, preserving tone and meaning, not word for word.",
    ...(meta.titleFirst
      ? [
          "The FIRST line of the input is the song title, not a lyric. Translate it as a title.",
        ]
      : []),
    `There are exactly ${lines.length} lines. Output exactly ${lines.length} lines in the same order.`,
    "Keep empty lines empty. Do not merge, split, or reorder lines.",
    "Output ONLY a JSON array of strings, one per input line. No other text.",
    "",
    "Lyrics (JSON array):",
    JSON.stringify(lines),
  ].join("\n");
}

function buildGlossPrompt(word: string, context: string): string {
  return [
    "Gloss one word from a Spanish lyric line for an English language learner.",
    "Return the meaning of the word as used in the line, not every dictionary meaning.",
    "Output ONLY one JSON object with exactly these string fields:",
    '{"word":"...","gloss":"...","partOfSpeech":"...","note":"..."}',
    "gloss must be concise English, 1 to 6 words.",
    "partOfSpeech must be one of: noun, verb, adj, adv, pron, prep, conj, interj, phrase.",
    'note must be a short idiom or usage note, or "" if none.',
    "",
    `Word: ${JSON.stringify(word)}`,
    `Lyric line: ${JSON.stringify(context)}`,
  ].join("\n");
}

export class GeminiProvider implements TranslationProvider {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async translate(lines: string[], meta: TrackMeta): Promise<string[]> {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: buildPrompt(lines, meta),
        config: { responseMimeType: "application/json" },
      });
      return parseTranslationResponse(response.text ?? "", lines.length);
    } catch (err) {
      if (isModelNotFoundError(err)) {
        throw new TranslationFailedError(
          `Gemini model "${this.model}" is unavailable. Set GEMINI_MODEL to a supported Gemini model, for example ${DEFAULT_MODEL}.`
        );
      }
      throw err;
    }
  }

  async glossWord(word: string, context: string): Promise<GlossEntry> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.client.models.generateContent({
          model: this.model,
          contents: buildGlossPrompt(word, context),
          config: { responseMimeType: "application/json" },
        });
        return parseGlossResponse(response.text ?? "");
      } catch (err) {
        if (isModelNotFoundError(err)) {
          throw new TranslationFailedError(
            `Gemini model "${this.model}" is unavailable. Set GEMINI_MODEL to a supported Gemini model, for example ${DEFAULT_MODEL}.`
          );
        }
        if (err instanceof GlossShapeError) {
          if (attempt === 0) continue;
          throw new TranslationFailedError(
            "Gloss provider returned malformed output"
          );
        }
        throw err;
      }
    }
    throw new TranslationFailedError("Gloss provider returned malformed output");
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function isRateLimitError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  const code = (err as { code?: unknown })?.code;
  if (status === 429 || code === 429) return true;
  return /\b429\b|RESOURCE_EXHAUSTED/.test(errorText(err));
}

function isModelNotFoundError(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  const code = (err as { code?: unknown })?.code;
  const text = errorText(err);
  const isNotFound = status === 404 || code === 404 || /\b404\b/.test(text);
  return (
    isNotFound &&
    /model/i.test(text) &&
    /(not found|no longer available|not available|unavailable)/i.test(text)
  );
}

// Gemini 429 errors carry a suggested wait, either as a RetryInfo
// detail ("retryDelay": "7s") or as prose ("Please retry in 7.5s").
export function parseRetryDelayMs(err: unknown): number | null {
  const text = errorText(err);
  const match =
    text.match(/"retryDelay"\s*:\s*"([\d.]+)s"/) ||
    text.match(/retry in ([\d.]+)\s*s/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.round(seconds * 1000), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One provider call with rate-limit handling. Returns null on a soft
// failure (bad line count, non-429 provider error) so the caller can
// fall back. Throws TranslationFailedError when the rate limit does
// not clear within the retry budget: burning more quota on fallback
// requests at that point would only make things worse.
async function callProvider(
  provider: TranslationProvider,
  lines: string[],
  meta: TrackMeta
): Promise<string[] | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await provider.translate(lines, meta);
      return result.length === lines.length ? result : null;
    } catch (err) {
      if (err instanceof TranslationFailedError) throw err;
      if (!isRateLimitError(err)) return null;
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new TranslationFailedError(
          "Translation provider rate limit not cleared after retries"
        );
      }
      const delay =
        parseRetryDelayMs(err) ?? DEFAULT_RETRY_DELAY_MS * (attempt + 1);
      await sleep(delay);
    }
  }
}

async function callGlossProvider(
  provider: TranslationProvider,
  word: string,
  context: string
): Promise<GlossEntry | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return validateGlossEntry(await provider.glossWord(word, context));
    } catch (err) {
      if (err instanceof TranslationFailedError) throw err;
      if (err instanceof GlossShapeError) return null;
      if (!isRateLimitError(err)) {
        throw new TranslationFailedError(
          err instanceof Error ? err.message : "Gloss provider failed"
        );
      }
      if (attempt >= MAX_RATE_LIMIT_RETRIES) {
        throw new TranslationFailedError(
          "Gloss provider rate limit not cleared after retries"
        );
      }
      const delay =
        parseRetryDelayMs(err) ?? DEFAULT_RETRY_DELAY_MS * (attempt + 1);
      await sleep(delay);
    }
  }
}

export async function glossWord(
  provider: TranslationProvider,
  word: string,
  context: string
): Promise<GlossEntry> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callGlossProvider(provider, word, context);
    if (result) return result;
  }
  throw new TranslationFailedError("Gloss provider returned malformed output");
}

// Runs the provider with the line-count contract: try the full batch
// twice, then fall back to chunks of CHUNK_SIZE lines, each still
// strictly N-in N-out. Any chunk failure fails the whole translation;
// there is no per-line fallback and never a partial result.
export async function translateLines(
  provider: TranslationProvider,
  lines: string[],
  meta: TrackMeta
): Promise<string[]> {
  if (lines.length === 0) return [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callProvider(provider, lines, meta);
    if (result) return result;
  }

  const out: string[] = [];
  for (let start = 0; start < lines.length; start += CHUNK_SIZE) {
    const chunk = lines.slice(start, start + CHUNK_SIZE);
    const result = await callProvider(provider, chunk, meta);
    if (!result) {
      throw new TranslationFailedError(
        `Translation failed for lines ${start + 1} to ${start + chunk.length}`
      );
    }
    out.push(...result);
  }
  return out;
}

// Same contract as translateLines, with the song title prepended as
// the first line of the batch so one request covers both. The N-in
// N-out validation counts the title line; in the chunked fallback the
// title rides in the first chunk and only that chunk's prompt gets the
// title-first note.
export async function translateLinesWithTitle(
  provider: TranslationProvider,
  lines: string[],
  meta: TrackMeta
): Promise<{ titleEn: string; en: string[] }> {
  if (lines.length === 0) return { titleEn: "", en: [] };

  const batch = [meta.title, ...lines];
  const titledMeta: TrackMeta = { ...meta, titleFirst: true };

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await callProvider(provider, batch, titledMeta);
    if (result) return { titleEn: result[0], en: result.slice(1) };
  }

  const out: string[] = [];
  for (let start = 0; start < batch.length; start += CHUNK_SIZE) {
    const chunk = batch.slice(start, start + CHUNK_SIZE);
    const result = await callProvider(
      provider,
      chunk,
      start === 0 ? titledMeta : meta
    );
    if (!result) {
      throw new TranslationFailedError(
        `Translation failed for lines ${start + 1} to ${start + chunk.length}`
      );
    }
    out.push(...result);
  }
  return { titleEn: out[0], en: out.slice(1) };
}

export async function translateTitle(
  provider: TranslationProvider,
  meta: TrackMeta
): Promise<string> {
  const result = await callProvider(provider, [meta.title], {
    ...meta,
    titleFirst: true,
  });
  if (!result) {
    throw new TranslationFailedError("Title translation failed");
  }
  return result[0];
}
