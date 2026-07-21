import { describe, expect, it } from "vitest";
import type { VocabEntry } from "../types";
import {
  VOCAB_CSV_COLUMNS,
  csvField,
  insertBySavedAt,
  savedKeySet,
  upsertEntry,
  vocabCsv,
  vocabKey,
} from "./vocab";

function entry(over: Partial<VocabEntry>): VocabEntry {
  return {
    id: "a".repeat(40),
    word: "corazon",
    gloss: "heart",
    partOfSpeech: "noun",
    note: "",
    contextLine: "Mi corazon late por ti",
    trackId: "t1",
    trackTitle: "Cancion",
    artist: "Artista",
    savedAt: "2026-07-21T10:00:00.000Z",
    ...over,
  };
}

describe("vocabKey", () => {
  it("is case-insensitive", () => {
    expect(vocabKey("Corazon", "Mi Corazon late")).toBe(
      vocabKey("corazon", "mi corazon late")
    );
  });

  it("is accent-insensitive across composed and decomposed forms", () => {
    expect(vocabKey("corazón", "late")).toBe(vocabKey("corazon", "late"));
    expect(vocabKey("corazón", "late")).toBe(
      vocabKey("corazón", "late")
    );
  });

  it("collapses whitespace in both parts", () => {
    expect(vocabKey(" luz ", "  Dame   luz  ")).toBe(
      vocabKey("luz", "Dame luz")
    );
  });

  it("keeps word and context from bleeding into each other", () => {
    expect(vocabKey("a", "b c")).not.toBe(vocabKey("a b", "c"));
  });
});

describe("savedKeySet", () => {
  it("keys entries by normalized word+context", () => {
    const set = savedKeySet([entry({})]);
    expect(set.has(vocabKey("CORAZÓN", "mi corazon  late por ti"))).toBe(
      true
    );
    expect(set.has(vocabKey("corazon", "otra linea"))).toBe(false);
  });
});

describe("insertBySavedAt", () => {
  const older = entry({ id: "1".repeat(40), savedAt: "2026-07-01T00:00:00Z" });
  const newer = entry({ id: "2".repeat(40), savedAt: "2026-07-20T00:00:00Z" });

  it("restores an entry to its position between neighbors", () => {
    const middle = entry({
      id: "3".repeat(40),
      word: "luz",
      contextLine: "Dame luz",
      savedAt: "2026-07-10T00:00:00Z",
    });
    expect(insertBySavedAt([newer, older], middle)).toEqual([
      newer,
      middle,
      older,
    ]);
  });

  it("appends the oldest and prepends the newest", () => {
    const oldest = entry({ id: "4".repeat(40), savedAt: "2025-01-01T00:00:00Z" });
    const newest = entry({ id: "5".repeat(40), savedAt: "2026-07-21T00:00:00Z" });
    expect(insertBySavedAt([newer, older], oldest).at(-1)).toBe(oldest);
    expect(insertBySavedAt([newer, older], newest)[0]).toBe(newest);
  });
});

describe("upsertEntry", () => {
  it("replaces the provisional entry with the same key instead of duplicating", () => {
    const provisional = entry({ id: "pending", savedAt: "2026-07-21T10:00:00Z" });
    const fromServer = entry({ savedAt: "2026-07-21T10:00:01Z" });
    const other = entry({
      id: "9".repeat(40),
      word: "luz",
      contextLine: "Dame luz",
      savedAt: "2026-07-01T00:00:00Z",
    });
    const next = upsertEntry([provisional, other], fromServer);
    expect(next).toEqual([fromServer, other]);
  });

  it("matches on the normalized key, not object identity", () => {
    const saved = entry({});
    const variant = entry({
      word: "CORAZÓN",
      savedAt: "2026-07-22T00:00:00Z",
    });
    expect(upsertEntry([saved], variant)).toEqual([variant]);
  });
});

describe("csvField", () => {
  it("passes plain values through unquoted", () => {
    expect(csvField("hola")).toBe("hola");
    expect(csvField("")).toBe("");
  });

  it("quotes fields containing commas", () => {
    expect(csvField("late, fuerte")).toBe('"late, fuerte"');
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvField('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvField('"')).toBe('""""');
  });

  it("quotes fields containing newlines", () => {
    expect(csvField("a\nb")).toBe('"a\nb"');
    expect(csvField("a\r\nb")).toBe('"a\r\nb"');
  });
});

describe("vocabCsv", () => {
  it("emits the header row and one CRLF-terminated row per entry", () => {
    const csv = vocabCsv([entry({})]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(VOCAB_CSV_COLUMNS.join(","));
    expect(lines[1]).toBe(
      "corazon,heart,noun,,Mi corazon late por ti,Cancion,Artista,2026-07-21T10:00:00.000Z"
    );
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("quotes tricky fields in place", () => {
    const csv = vocabCsv([
      entry({
        gloss: 'so-called "heart", figurative',
        contextLine: "linea\ncortada",
        trackTitle: "Cancion, Pt. 2",
      }),
    ]);
    expect(csv).toContain('"so-called ""heart"", figurative"');
    expect(csv).toContain('"linea\ncortada"');
    expect(csv).toContain('"Cancion, Pt. 2"');
  });

  it("renders only the header for an empty list", () => {
    expect(vocabCsv([])).toBe(VOCAB_CSV_COLUMNS.join(",") + "\r\n");
  });
});
