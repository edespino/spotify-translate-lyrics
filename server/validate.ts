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
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) text = fence[1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Provider response is not valid JSON");
  }
  return validateLineCount(parsed, expected);
}

export function validateLineCount(value: unknown, expected: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Provider response is not an array");
  }
  if (value.length !== expected) {
    throw new LineCountError(expected, value.length);
  }
  return value.map((v) => (typeof v === "string" ? v : String(v ?? "")));
}
