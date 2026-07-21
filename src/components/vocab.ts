// Pure logic for vocabulary capture: the dedupe key shared with the
// server, the list operations behind the optimistic save/delete flow,
// and CSV export. Split out of the components so all of it is testable
// without a DOM.

import type { VocabEntry } from "../types";

// Mirrors the server's normalization (normalizeGlossText in
// server/cache.ts) exactly: a word saved as "Corazón" must read as
// saved when the popover shows "corazon", or the client's saved-ness
// check and the server's dedupe would disagree.
export function normalizeVocabText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

export function vocabKey(word: string, context: string): string {
  return `${normalizeVocabText(word)}\u0000${normalizeVocabText(context)}`;
}

export function savedKeySet(entries: readonly VocabEntry[]): Set<string> {
  return new Set(entries.map((e) => vocabKey(e.word, e.contextLine)));
}

// Insert keeping newest-first order by savedAt (ISO strings compare
// lexicographically; ties put the inserted entry first), so a rollback
// re-insert after a failed delete lands back where the entry was.
export function insertBySavedAt(
  entries: readonly VocabEntry[],
  entry: VocabEntry
): VocabEntry[] {
  const at = entries.findIndex((e) => e.savedAt <= entry.savedAt);
  if (at === -1) return [...entries, entry];
  return [...entries.slice(0, at), entry, ...entries.slice(at)];
}

// Replace any entry with the same normalized word+context (the
// provisional entry an optimistic save added), keeping newest-first
// order.
export function upsertEntry(
  entries: readonly VocabEntry[],
  entry: VocabEntry
): VocabEntry[] {
  const key = vocabKey(entry.word, entry.contextLine);
  return insertBySavedAt(
    entries.filter((e) => vocabKey(e.word, e.contextLine) !== key),
    entry
  );
}

// CSV per RFC 4180: fields containing commas, quotes, or line breaks
// are wrapped in quotes with embedded quotes doubled; everything else
// is written as-is.
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const VOCAB_CSV_COLUMNS = [
  "word",
  "gloss",
  "partOfSpeech",
  "note",
  "context",
  "track",
  "artist",
  "savedAt",
] as const;

export function vocabCsv(entries: readonly VocabEntry[]): string {
  const lines = [
    VOCAB_CSV_COLUMNS.join(","),
    ...entries.map((e) =>
      [
        e.word,
        e.gloss,
        e.partOfSpeech,
        e.note,
        e.contextLine,
        e.trackTitle,
        e.artist,
        e.savedAt,
      ]
        .map(csvField)
        .join(",")
    ),
  ];
  return lines.join("\r\n") + "\r\n";
}
