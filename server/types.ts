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
  lines: TranslationLine[];
}

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
}
