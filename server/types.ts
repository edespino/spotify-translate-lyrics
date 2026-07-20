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
  lines: TranslationLine[];
}

export interface TrackMeta {
  trackId: string;
  title: string;
  artist: string;
}

export interface TranslationProvider {
  translate(lines: string[], meta: TrackMeta): Promise<string[]>;
}
