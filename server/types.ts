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
  // English translation of the title. Absent in cache files written
  // before title translation existed; those render without one.
  titleEn?: string;
  // LRCLIB numeric id of the entry the lyrics came from. Absent in
  // cache files written before it was captured.
  lrclibId?: number;
  lines: TranslationLine[];
}

// One track whose LRCLIB lyrics the user marked wrong. While a record
// exists the app suppresses the track's lyrics entirely. lrclibId is
// kept so the entry can be flagged to LRCLIB; absent when the mark was
// made without one.
export interface MarkedTrack {
  trackId: string;
  title: string;
  artist: string;
  markedAt: string;
  lrclibId?: number;
}

export interface GlossEntry {
  word: string;
  gloss: string;
  partOfSpeech: string;
  note: string;
}

// One saved vocabulary word. The id is the sha1 of the normalized
// word+context pair (same normalization as the gloss cache), so it is
// stable and doubles as the dedupe key.
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

export interface TrackMeta {
  trackId: string;
  title: string;
  artist: string;
  // True when the first line of the batch is the song title rather
  // than a lyric, so the prompt can say so.
  titleFirst?: boolean;
}

export interface TranslationProvider {
  translate(lines: string[], meta: TrackMeta): Promise<string[]>;
  glossWord(word: string, context: string): Promise<GlossEntry>;
}
