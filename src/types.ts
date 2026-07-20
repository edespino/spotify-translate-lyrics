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
