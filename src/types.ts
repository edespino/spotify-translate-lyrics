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

export type LyricsResult =
  | { kind: "synced"; lines: LyricLine[] }
  | { kind: "plain"; lines: string[] }
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
  lines: TranslationLine[];
}

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
