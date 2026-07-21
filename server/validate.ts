import type { GlossEntry } from "./types";

// Parses and validates a provider response. The prompt contract asks
// for a JSON array of exactly `expected` strings. Accepts raw JSON or
// JSON wrapped in a markdown code fence.
export class LineCountError extends Error {
  constructor(expected: number, got: number) {
    super(`Expected ${expected} lines, got ${got}`);
  }
}

export function parseTranslationResponse(
  raw: string,
  expected: number
): string[] {
  const text = unwrapJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Provider response is not valid JSON");
  }
  return validateLineCount(parsed, expected);
}

function unwrapJsonFence(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  return text;
}

const PARTS_OF_SPEECH = new Set([
  "noun",
  "verb",
  "adj",
  "adv",
  "pron",
  "prep",
  "conj",
  "interj",
  "phrase",
]);

const MAX_GLOSS_WORD_CHARS = 64;
const MAX_GLOSS_CHARS = 120;
const MAX_GLOSS_NOTE_CHARS = 200;

export class GlossShapeError extends Error {}

export function parseGlossResponse(raw: string): GlossEntry {
  const text = unwrapJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GlossShapeError("Provider response is not valid JSON");
  }
  return validateGlossEntry(parsed);
}

export function validateLineCount(value: unknown, expected: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Provider response is not an array");
  }
  if (value.length !== expected) {
    throw new LineCountError(expected, value.length);
  }
  if (!value.every((v) => typeof v === "string")) {
    throw new Error("Provider response contains non-string members");
  }
  return value as string[];
}

export function validateGlossEntry(value: unknown): GlossEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GlossShapeError("Provider gloss response is not an object");
  }
  const keys = Object.keys(value);
  const expected = ["word", "gloss", "partOfSpeech", "note"];
  if (
    keys.length !== expected.length ||
    !expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new GlossShapeError("Provider gloss response has unexpected fields");
  }

  const entry = value as Record<string, unknown>;
  if (
    typeof entry.word !== "string" ||
    typeof entry.gloss !== "string" ||
    typeof entry.partOfSpeech !== "string" ||
    typeof entry.note !== "string"
  ) {
    throw new GlossShapeError("Provider gloss response contains non-strings");
  }
  if (!PARTS_OF_SPEECH.has(entry.partOfSpeech)) {
    throw new GlossShapeError("Provider gloss response has bad partOfSpeech");
  }
  if (entry.gloss.trim() === "") {
    throw new GlossShapeError("Provider gloss response has empty gloss");
  }
  if (entry.word.trim() === "") {
    throw new GlossShapeError("Provider gloss response has empty word");
  }
  if (entry.word.length > MAX_GLOSS_WORD_CHARS) {
    throw new GlossShapeError("Provider gloss response has long word");
  }
  if (entry.gloss.length > MAX_GLOSS_CHARS) {
    throw new GlossShapeError("Provider gloss response has long gloss");
  }
  if (entry.note.length > MAX_GLOSS_NOTE_CHARS) {
    throw new GlossShapeError("Provider gloss response has long note");
  }
  if (entry.gloss.trim().split(/\s+/).length > 6) {
    throw new GlossShapeError("Provider gloss response has long gloss");
  }
  return {
    word: entry.word,
    gloss: entry.gloss,
    partOfSpeech: entry.partOfSpeech,
    note: entry.note,
  };
}
