// Pure logic for the lyrics correction editor, split out so it is
// testable without a DOM: the editor's line model, the multi-select
// model with shift-click ranges, line deletion, paste-mode detection
// (LRC vs plain), and the override payload built on save. Timestamps
// are never editable (repo rule): a synced line keeps its timeMs
// through edits, and deleting a line removes its whole row while the
// remaining lines keep their timing.

import { parseLrc } from "../lrc";
import type { SaveLyricsOverrideInput } from "../api";
import type { LyricsResult, PlaybackState } from "../types";

// timeMs is null for unsynced lines; the editor shows a timestamp cell
// only when it is present.
export interface EditorLine {
  timeMs: number | null;
  text: string;
}

export function editorLinesFrom(result: LyricsResult): EditorLine[] {
  if (result.kind === "synced") {
    return result.lines.map((l) => ({ timeMs: l.timeMs, text: l.text }));
  }
  if (result.kind === "plain") {
    return result.lines.map((text) => ({ timeMs: null, text }));
  }
  return [];
}

// Checkbox selection with shift-click ranges. A plain click toggles the
// line and re-anchors there; a shift-click with an anchor adds the
// whole anchor-to-line range (either direction), keeping the anchor so
// repeated shift-clicks extend from the same point. A shift-click with
// no anchor behaves like a plain click.
export interface LineSelection {
  indices: ReadonlySet<number>;
  anchor: number | null;
}

export const EMPTY_SELECTION: LineSelection = {
  indices: new Set(),
  anchor: null,
};

export function toggleSelection(
  selection: LineSelection,
  index: number,
  shift: boolean
): LineSelection {
  if (shift && selection.anchor !== null) {
    const lo = Math.min(selection.anchor, index);
    const hi = Math.max(selection.anchor, index);
    const indices = new Set(selection.indices);
    for (let i = lo; i <= hi; i++) indices.add(i);
    return { indices, anchor: selection.anchor };
  }
  const indices = new Set(selection.indices);
  if (indices.has(index)) indices.delete(index);
  else indices.add(index);
  return { indices, anchor: index };
}

export function deleteSelected(
  lines: EditorLine[],
  selection: LineSelection
): EditorLine[] {
  return lines.filter((_, i) => !selection.indices.has(i));
}

export function setLineText(
  lines: EditorLine[],
  index: number,
  text: string
): EditorLine[] {
  return lines.map((line, i) => (i === index ? { ...line, text } : line));
}

// Paste-replace input is LRC when the existing parser finds at least
// one timestamped line; anything else is plain text, one lyric line per
// text line (same edge trimming as the LRCLIB plain path: leading and
// trailing blanks drop, interior blanks stay).
export type PasteKind = "lrc" | "plain";

export function detectPasteKind(text: string): PasteKind {
  return parseLrc(text).length > 0 ? "lrc" : "plain";
}

export function parsePaste(text: string): EditorLine[] {
  if (detectPasteKind(text) === "lrc") {
    return parseLrc(text).map((l) => ({ timeMs: l.timeMs, text: l.text }));
  }
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l, i, arr) => l.length > 0 || (i > 0 && i < arr.length - 1))
    .map((line) => ({ timeMs: null, text: line }));
}

// The override kind: synced only when every line carries a timestamp
// (LRC paste or an edit of synced lyrics), plain otherwise.
export function editorKind(lines: EditorLine[]): "synced" | "plain" {
  return lines.length > 0 && lines.every((l) => l.timeMs !== null)
    ? "synced"
    : "plain";
}

export function canSaveLines(lines: EditorLine[]): boolean {
  return lines.some((l) => l.text.trim() !== "");
}

export function overrideInput(
  playback: Pick<PlaybackState, "trackId" | "title" | "artist">,
  lines: EditorLine[],
  lrclibId: number | undefined
): SaveLyricsOverrideInput {
  return {
    trackId: playback.trackId,
    title: playback.title,
    artist: playback.artist,
    kind: editorKind(lines),
    lines: lines.map((l) => ({ timeMs: l.timeMs ?? 0, text: l.text })),
    ...(typeof lrclibId === "number" ? { lrclibId } : {}),
  };
}

// mm:ss.cc, the LRC shape without brackets, for the muted timestamp
// cell.
export function formatTimestamp(timeMs: number): string {
  const totalCs = Math.round(timeMs / 10);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const m = Math.floor(totalS / 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(
    cs
  ).padStart(2, "0")}`;
}
