import { describe, expect, it } from "vitest";
import {
  EMPTY_SELECTION,
  canSaveLines,
  deleteSelected,
  detectPasteKind,
  editorKind,
  editorLinesFrom,
  formatTimestamp,
  overrideInput,
  parsePaste,
  setLineText,
  toggleSelection,
  type EditorLine,
  type LineSelection,
} from "./lyricsEditing";

const syncedLines: EditorLine[] = [
  { timeMs: 0, text: "english intro" },
  { timeMs: 1000, text: "more english" },
  { timeMs: 2000, text: "hola" },
  { timeMs: 3000, text: "adios" },
  { timeMs: 4000, text: "english outro" },
];

const selection = (indices: number[], anchor: number | null): LineSelection => ({
  indices: new Set(indices),
  anchor,
});

describe("editorLinesFrom", () => {
  it("keeps timestamps from synced lyrics", () => {
    expect(
      editorLinesFrom({
        kind: "synced",
        lines: [
          { timeMs: 500, text: "a" },
          { timeMs: 900, text: "b" },
        ],
      })
    ).toEqual([
      { timeMs: 500, text: "a" },
      { timeMs: 900, text: "b" },
    ]);
  });

  it("maps plain lyrics to untimed lines", () => {
    expect(editorLinesFrom({ kind: "plain", lines: ["a", "b"] })).toEqual([
      { timeMs: null, text: "a" },
      { timeMs: null, text: "b" },
    ]);
  });

  it("maps non-lyric results to no lines", () => {
    expect(editorLinesFrom({ kind: "instrumental" })).toEqual([]);
    expect(editorLinesFrom({ kind: "none" })).toEqual([]);
  });
});

describe("toggleSelection", () => {
  it("plain click toggles a line and anchors there", () => {
    const one = toggleSelection(EMPTY_SELECTION, 2, false);
    expect([...one.indices]).toEqual([2]);
    expect(one.anchor).toBe(2);
    const off = toggleSelection(one, 2, false);
    expect(off.indices.size).toBe(0);
    expect(off.anchor).toBe(2);
  });

  it("shift-click selects the whole range from the anchor", () => {
    const anchored = toggleSelection(EMPTY_SELECTION, 1, false);
    const ranged = toggleSelection(anchored, 4, true);
    expect([...ranged.indices].sort()).toEqual([1, 2, 3, 4]);
    expect(ranged.anchor).toBe(1);
  });

  it("shift-click ranges work upward from the anchor too", () => {
    const anchored = toggleSelection(EMPTY_SELECTION, 3, false);
    const ranged = toggleSelection(anchored, 0, true);
    expect([...ranged.indices].sort()).toEqual([0, 1, 2, 3]);
  });

  it("repeated shift-clicks extend from the same anchor", () => {
    const anchored = toggleSelection(EMPTY_SELECTION, 0, false);
    const first = toggleSelection(anchored, 1, true);
    const second = toggleSelection(first, 3, true);
    expect([...second.indices].sort()).toEqual([0, 1, 2, 3]);
    expect(second.anchor).toBe(0);
  });

  it("shift-click without an anchor behaves like a plain click", () => {
    const sel = toggleSelection(EMPTY_SELECTION, 2, true);
    expect([...sel.indices]).toEqual([2]);
    expect(sel.anchor).toBe(2);
  });
});

describe("deleteSelected", () => {
  it("removes a single line, remaining lines keep their timing", () => {
    const out = deleteSelected(syncedLines, selection([1], 1));
    expect(out).toEqual([
      { timeMs: 0, text: "english intro" },
      { timeMs: 2000, text: "hola" },
      { timeMs: 3000, text: "adios" },
      { timeMs: 4000, text: "english outro" },
    ]);
  });

  it("removes whole sections at the top and bottom", () => {
    const out = deleteSelected(syncedLines, selection([0, 1, 4], 4));
    expect(out).toEqual([
      { timeMs: 2000, text: "hola" },
      { timeMs: 3000, text: "adios" },
    ]);
  });

  it("with nothing selected deletes nothing", () => {
    expect(deleteSelected(syncedLines, EMPTY_SELECTION)).toEqual(syncedLines);
  });
});

describe("setLineText", () => {
  it("replaces only the text, never the timestamp", () => {
    const out = setLineText(syncedLines, 2, "hola corregida");
    expect(out[2]).toEqual({ timeMs: 2000, text: "hola corregida" });
    expect(out[1]).toEqual(syncedLines[1]);
  });
});

describe("detectPasteKind and parsePaste", () => {
  it("detects LRC by timestamp syntax and keeps timing", () => {
    const lrc = "[00:02.50]hola\n[00:05]adios";
    expect(detectPasteKind(lrc)).toBe("lrc");
    expect(parsePaste(lrc)).toEqual([
      { timeMs: 2500, text: "hola" },
      { timeMs: 5000, text: "adios" },
    ]);
  });

  it("treats text without timestamps as plain, one lyric per line", () => {
    const plain = "hola\nadios";
    expect(detectPasteKind(plain)).toBe("plain");
    expect(parsePaste(plain)).toEqual([
      { timeMs: null, text: "hola" },
      { timeMs: null, text: "adios" },
    ]);
  });

  it("plain paste drops edge blanks and keeps interior ones", () => {
    expect(parsePaste("\nhola\n\nadios\n")).toEqual([
      { timeMs: null, text: "hola" },
      { timeMs: null, text: "" },
      { timeMs: null, text: "adios" },
    ]);
  });
});

describe("editorKind", () => {
  it("is synced only when every line has a timestamp", () => {
    expect(editorKind(syncedLines)).toBe("synced");
    expect(editorKind([{ timeMs: null, text: "a" }])).toBe("plain");
    expect(
      editorKind([
        { timeMs: 0, text: "a" },
        { timeMs: null, text: "b" },
      ])
    ).toBe("plain");
    expect(editorKind([])).toBe("plain");
  });
});

describe("canSaveLines", () => {
  it("requires at least one non-blank line", () => {
    expect(canSaveLines([])).toBe(false);
    expect(canSaveLines([{ timeMs: 0, text: "  " }])).toBe(false);
    expect(canSaveLines([{ timeMs: 0, text: "hola" }])).toBe(true);
  });
});

describe("overrideInput", () => {
  const playback = { trackId: "t1", title: "Cancion", artist: "Artista" };

  it("builds a synced override from timed lines", () => {
    expect(overrideInput(playback, syncedLines.slice(2, 4), 42)).toEqual({
      trackId: "t1",
      title: "Cancion",
      artist: "Artista",
      kind: "synced",
      lines: [
        { timeMs: 2000, text: "hola" },
        { timeMs: 3000, text: "adios" },
      ],
      lrclibId: 42,
    });
  });

  it("builds a plain override with zeroed times and no lrclibId", () => {
    expect(
      overrideInput(playback, [{ timeMs: null, text: "hola" }], undefined)
    ).toEqual({
      trackId: "t1",
      title: "Cancion",
      artist: "Artista",
      kind: "plain",
      lines: [{ timeMs: 0, text: "hola" }],
    });
  });
});

describe("formatTimestamp", () => {
  it("renders mm:ss.cc", () => {
    expect(formatTimestamp(0)).toBe("00:00.00");
    expect(formatTimestamp(2500)).toBe("00:02.50");
    expect(formatTimestamp(83450)).toBe("01:23.45");
    expect(formatTimestamp(600000)).toBe("10:00.00");
  });
});
