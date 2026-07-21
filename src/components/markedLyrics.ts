// Pure logic for the wrong-lyrics mark, split out so it is testable
// without a DOM: when the mark affordance shows, the marked screen's
// message, the report button's availability, and the shape of the mark
// request built from the current playback and lyrics.

import type { LyricsState } from "../App";
import type { LyricsResult, MarkedTrack, PlaybackState } from "../types";

export const MARKED_MESSAGE = "Lyrics marked as incorrect.";

// The mark affordance only makes sense while lyrics are actually
// showing; the other states already have their own screens.
export function canMarkWrong(lyrics: LyricsState): boolean {
  return (
    lyrics.status === "ready" &&
    (lyrics.result.kind === "synced" || lyrics.result.kind === "plain")
  );
}

export type ReportState = "idle" | "pending" | "sent";

export interface ReportSpec {
  label: string;
  enabled: boolean;
  title: string;
}

// The report button needs the LRCLIB numeric id from the mark record;
// marks made before the id was captured disable it with an explanation.
// A sent report stays disabled for the session: reporting is one-shot.
export function reportSpec(
  record: MarkedTrack,
  state: ReportState
): ReportSpec {
  if (typeof record.lrclibId !== "number") {
    return {
      label: "Report to LRCLIB",
      enabled: false,
      title:
        "No LRCLIB id recorded for this track. Reset the mark and let the lyrics load once to capture it.",
    };
  }
  if (state === "pending") {
    return { label: "Reporting...", enabled: false, title: "Sending" };
  }
  if (state === "sent") {
    return { label: "Reported", enabled: false, title: "Already reported" };
  }
  return {
    label: "Report to LRCLIB",
    enabled: true,
    title: "Send a community flag for this entry to LRCLIB",
  };
}

// Gate for the lyric-loading effect: nothing loads for ANY track until
// the marks list has resolved (otherwise a marked track playing at boot
// would hit LRCLIB before the marks arrive), marked tracks never load,
// and a track already kicked off does not load twice. When the marks
// fetch fails the caller flags ready anyway and proceeds as unmarked:
// availability over suppression.
export function shouldLoadLyrics(
  trackId: string | null,
  marksReady: boolean,
  marks: Map<string, MarkedTrack>,
  loadedTrackId: string | null
): boolean {
  if (!trackId || !marksReady) return false;
  if (marks.has(trackId)) return false;
  return loadedTrackId !== trackId;
}

// Local stand-in when the server answers that a track is marked but the
// client's marks map does not have it (stale after a 409 from
// /api/translate): enough to suppress the lyrics immediately; the real
// record (with lrclibId) is refreshed from GET /api/marks best-effort.
export function markedFallbackRecord(
  playback: Pick<PlaybackState, "trackId" | "title" | "artist">
): MarkedTrack {
  return {
    trackId: playback.trackId,
    title: playback.title,
    artist: playback.artist,
    markedAt: new Date().toISOString(),
  };
}

export function toMarkMap(
  records: MarkedTrack[]
): Map<string, MarkedTrack> {
  return new Map(records.map((r) => [r.trackId, r]));
}

export interface MarkWrongRequest {
  trackId: string;
  title: string;
  artist: string;
  lrclibId?: number;
}

// The LRCLIB numeric id rides along from the lyrics result when it has
// one (synced and plain results fetched since the id was captured).
export function markRequest(
  playback: Pick<PlaybackState, "trackId" | "title" | "artist">,
  result: LyricsResult
): MarkWrongRequest {
  const lrclibId =
    result.kind === "synced" || result.kind === "plain"
      ? result.lrclibId
      : undefined;
  return {
    trackId: playback.trackId,
    title: playback.title,
    artist: playback.artist,
    ...(typeof lrclibId === "number" ? { lrclibId } : {}),
  };
}
