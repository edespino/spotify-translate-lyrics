import { parseLrc } from "./lrc";
import type { LyricsResult } from "./types";

interface LrclibResponse {
  instrumental?: boolean;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}

// LRCLIB allows CORS, so this is called directly from the browser.
export async function fetchLyrics(
  title: string,
  artist: string,
  album: string,
  durationMs: number
): Promise<LyricsResult> {
  const params = new URLSearchParams({
    track_name: title,
    artist_name: artist,
    album_name: album,
    duration: String(Math.round(durationMs / 1000)),
  });
  const res = await fetch(`https://lrclib.net/api/get?${params}`);
  if (res.status === 404) return { kind: "none" };
  if (!res.ok) throw new Error(`LRCLIB error ${res.status}`);
  const data = (await res.json()) as LrclibResponse;
  if (data.instrumental) return { kind: "instrumental" };
  if (data.syncedLyrics) {
    const lines = parseLrc(data.syncedLyrics);
    if (lines.length > 0) return { kind: "synced", lines };
  }
  if (data.plainLyrics) {
    const lines = data.plainLyrics
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l, i, arr) => l.length > 0 || (i > 0 && i < arr.length - 1));
    if (lines.length > 0) return { kind: "plain", lines };
  }
  return { kind: "none" };
}
