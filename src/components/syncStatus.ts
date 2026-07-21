// Pure logic for the lyric sync-status badge in the NowPlaying header,
// split out so it is testable without a DOM: which lyrics states earn a
// badge and its label plus title text.

import type { LyricsState } from "../App";

export interface SyncBadgeSpec {
  label: string;
  title: string;
}

// Only lyric-bearing results get a badge; instrumental, none, loading,
// and error states already have their own EmptyState screens, and a
// loading badge would flicker on every track change.
export function syncBadge(lyrics: LyricsState): SyncBadgeSpec | null {
  if (lyrics.status !== "ready") return null;
  if (lyrics.result.kind === "synced") {
    return {
      label: "Synced",
      title: "Time-synced lyrics: the highlight follows playback.",
    };
  }
  if (lyrics.result.kind === "plain") {
    return {
      label: "Unsynced",
      title:
        "No timestamps exist on LRCLIB for this track, so lyrics show as static text with no moving highlight.",
    };
  }
  return null;
}
