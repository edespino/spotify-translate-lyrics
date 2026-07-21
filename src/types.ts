export interface PlaybackState {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
  albumArtUrl: string;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

// lrclibId is the LRCLIB numeric id of the entry the lyrics came from,
// kept so a wrong entry can be flagged to LRCLIB later.
export type LyricsResult =
  | { kind: "synced"; lines: LyricLine[]; lrclibId?: number }
  | { kind: "plain"; lines: string[]; lrclibId?: number }
  | { kind: "instrumental" }
  | { kind: "none" };

export interface TranslationLine {
  timeMs: number;
  es: string;
  en: string;
  editedEs?: string;
  editedEn?: string;
}

export interface TranslationEntry {
  trackId: string;
  title: string;
  artist: string;
  // Absent in cache entries written before title translation existed.
  titleEn?: string;
  // LRCLIB numeric id, absent in cache entries written before it was
  // captured.
  lrclibId?: number;
  lines: TranslationLine[];
}

// One track whose LRCLIB lyrics were marked wrong, as stored by the
// server. While a record exists the app suppresses the track's lyrics
// and makes no LRCLIB or translation calls for it.
export interface MarkedTrack {
  trackId: string;
  title: string;
  artist: string;
  markedAt: string;
  lrclibId?: number;
}

// User-corrected lyric source for one track, as stored by the server.
// While a record exists the app loads the track's lyrics from it and
// never consults LRCLIB. Plain (unsynced) overrides store timeMs 0 on
// every line.
export interface LyricsOverrideLine {
  timeMs: number;
  text: string;
}

export interface LyricsOverrideRecord {
  trackId: string;
  title: string;
  artist: string;
  kind: "synced" | "plain";
  lines: LyricsOverrideLine[];
  lrclibId?: number;
  savedAt: string;
}

// The list endpoint returns records without their lines, enough to
// route lyric loading without shipping every override body.
export type LyricsOverrideSummary = Omit<LyricsOverrideRecord, "lines">;

// One saved vocabulary word, as stored by the server. The id is the
// sha1 of the normalized word+context pair and doubles as the dedupe
// key; savedAt is an ISO timestamp stamped by the server.
export interface VocabEntry {
  id: string;
  word: string;
  gloss: string;
  partOfSpeech: string;
  note: string;
  contextLine: string;
  trackId: string;
  trackTitle: string;
  artist: string;
  savedAt: string;
}

export type VocabInput = Omit<VocabEntry, "id" | "savedAt">;
