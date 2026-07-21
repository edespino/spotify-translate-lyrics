// Pure logic for lyric-source overrides, split out so it is testable
// without a DOM: routing lyric loading to the override store instead of
// LRCLIB (the zero-network guarantee while an override exists), mapping
// a stored override back to a LyricsResult, and the quiet source link
// to the LRCLIB record.

import type {
  LyricsOverrideRecord,
  LyricsOverrideSummary,
  LyricsResult,
} from "../types";

// Where loadLyrics gets a track's lyrics from. The LRCLIB fetch lives
// client-side (src/lyrics.ts), so this client seam is where
// override-vs-LRCLIB routing happens: while an override exists LRCLIB
// is never consulted for the track.
export type LyricsSource = "override" | "lrclib";

export function lyricsSourceFor(
  trackId: string,
  overrides: Map<string, LyricsOverrideSummary>
): LyricsSource {
  return overrides.has(trackId) ? "override" : "lrclib";
}

export function toOverrideMap(
  records: LyricsOverrideSummary[]
): Map<string, LyricsOverrideSummary> {
  return new Map(records.map((r) => [r.trackId, r]));
}

export function overrideSummary(
  record: LyricsOverrideRecord
): LyricsOverrideSummary {
  return {
    trackId: record.trackId,
    title: record.title,
    artist: record.artist,
    kind: record.kind,
    ...(typeof record.lrclibId === "number"
      ? { lrclibId: record.lrclibId }
      : {}),
    savedAt: record.savedAt,
  };
}

// A stored override renders exactly like a fetched LRCLIB result, so
// everything downstream (sync badge, translation flow, LyricsView) is
// untouched. The override kind maps straight to the result kind.
export function overrideToLyricsResult(
  record: LyricsOverrideRecord
): LyricsResult {
  const lrclibId =
    typeof record.lrclibId === "number" ? { lrclibId: record.lrclibId } : {};
  if (record.kind === "synced") {
    return {
      kind: "synced",
      lines: record.lines.map((l) => ({ timeMs: l.timeMs, text: l.text })),
      ...lrclibId,
    };
  }
  return {
    kind: "plain",
    lines: record.lines.map((l) => l.text),
    ...lrclibId,
  };
}

// Link to the LRCLIB record the lyrics came from: the exact API record
// when the numeric id is known, else a search for the track.
export function lrclibSourceUrl(
  lrclibId: number | undefined,
  title: string,
  artist: string
): string {
  if (typeof lrclibId === "number") {
    return `https://lrclib.net/api/get/${lrclibId}`;
  }
  return `https://lrclib.net/search/${encodeURIComponent(`${title} ${artist}`)}`;
}
