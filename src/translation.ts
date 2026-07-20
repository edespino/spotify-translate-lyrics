import { getTranslation, requestTranslation } from "./api";
import { shouldTranslate } from "./detect";
import type { LyricsResult, PlaybackState, TranslationEntry } from "./types";

// Resolves the translation for a track: cached entry first, then the
// server. Returns null without touching the network when the lyrics are
// already English or contain no translatable text.
export async function fetchTranslationIfNeeded(
  track: PlaybackState,
  result: LyricsResult
): Promise<TranslationEntry | null> {
  if (result.kind !== "synced" && result.kind !== "plain") return null;
  if (!shouldTranslate(result)) return null;
  const texts =
    result.kind === "synced" ? result.lines.map((l) => l.text) : result.lines;
  const times =
    result.kind === "synced"
      ? result.lines.map((l) => l.timeMs)
      : result.lines.map(() => 0);
  const cached = await getTranslation(track.trackId);
  if (cached) return cached;
  return requestTranslation(track.trackId, track.title, track.artist, texts, times);
}
