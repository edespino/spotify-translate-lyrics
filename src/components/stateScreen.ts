// Pure logic for the non-lyric state screens, split out so it is
// testable without a DOM: which lyrics states render as an empty-state
// screen, their messages, whether retry applies, and the skeleton bar
// widths for the translating column.

import type { LyricsState } from "../App";

export interface EmptyStateSpec {
  message: string;
  retryable: boolean;
}

// Only the lyrics-service error is retryable; the other states resolve
// on their own (loading) or are final for the track (none, instrumental).
export function lyricsEmptyState(lyrics: LyricsState): EmptyStateSpec | null {
  if (lyrics.status === "loading") {
    return { message: "Looking for lyrics...", retryable: false };
  }
  if (lyrics.status === "error") {
    return { message: "Could not reach the lyrics service.", retryable: true };
  }
  if (lyrics.status === "ready") {
    if (lyrics.result.kind === "none") {
      return { message: "No lyrics found for this track.", retryable: false };
    }
    if (lyrics.result.kind === "instrumental") {
      return { message: "Instrumental", retryable: false };
    }
  }
  return null;
}

const SKELETON_WIDTHS = ["45%", "60%", "75%"];

// Varied widths so a column of loading bars reads as upcoming text
// rather than a uniform block.
export function skeletonWidth(index: number): string {
  return SKELETON_WIDTHS[index % SKELETON_WIDTHS.length];
}
