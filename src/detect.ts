import type { LyricsResult } from "./types";

// Client-side language gate. Decides whether fetched lyrics are already
// English so translation can be skipped entirely (no /api/translate call,
// no Gemini usage, nothing cached). Pure stopword and character frequency
// heuristic over the full joined lyric text, no network, no library.
//
// The decision is deliberately biased: only a confidently English text
// returns true. Anything uncertain or mixed (Spanglish) returns false and
// the app translates, which is the pre-existing behavior.

const EN_WORDS = new Set([
  "the", "you", "and", "i", "to", "of", "in", "it", "is", "my", "your",
  "that", "we", "on", "with", "be", "this", "all", "for", "was", "are",
  "have", "but", "not", "what", "when", "she", "he", "they", "from",
  "know", "like", "just", "never", "now", "got", "get", "want", "will",
  "time", "up", "down", "out", "if", "so", "do", "been", "were", "would",
  "could", "one", "gonna", "wanna", "right", "back", "because", "about",
  "don't", "can't", "i'm", "it's", "you're", "i'll", "won't", "ain't",
]);

const ES_WORDS = new Set([
  "que", "de", "la", "el", "en", "y", "tu", "te", "mi", "es", "un",
  "una", "por", "con", "para", "del", "los", "las", "lo", "como",
  "pero", "mas", "más", "yo", "si", "sí", "esta", "está", "este",
  "cuando", "porque", "quiero", "corazón", "corazon", "amor", "vida",
  "nada", "siempre", "nunca", "todo", "toda", "eres", "estoy", "soy",
  "tengo", "donde", "dónde", "noche", "así", "asi", "aquí", "aqui",
  "ya", "muy", "bien", "dime", "hasta", "sin", "entre", "voy", "vas",
  "era", "fue", "hay", "le", "les", "nos", "otra", "otro", "solo",
  "sólo", "también", "tambien", "vez", "quien", "quién", "contigo",
  "conmigo", "tus", "sus", "mis",
]);

const SPANISH_MARKS = /[áéíóúüñ¿¡]/g;

export function isEnglishLyrics(text: string): boolean {
  const tokens = text.toLowerCase().match(/[a-záéíóúüñ']+/g) ?? [];
  if (tokens.length < 10) return false;

  let en = 0;
  let es = 0;
  for (const t of tokens) {
    if (EN_WORDS.has(t)) en++;
    if (ES_WORDS.has(t)) es++;
  }
  const enRate = en / tokens.length;
  const esRate = es / tokens.length;
  const marks = (text.match(SPANISH_MARKS) ?? []).length;

  // Confident English: plenty of English function words, near-zero
  // Spanish stopwords, and at most a stray accented character.
  return enRate >= 0.15 && esRate <= 0.02 && marks <= tokens.length / 200;
}

export function lyricsPlainText(result: LyricsResult): string {
  if (result.kind === "synced") return result.lines.map((l) => l.text).join("\n");
  if (result.kind === "plain") return result.lines.join("\n");
  return "";
}

// Single gate the app uses before any translation work.
export function shouldTranslate(result: LyricsResult): boolean {
  if (result.kind !== "synced" && result.kind !== "plain") return false;
  return !isEnglishLyrics(lyricsPlainText(result));
}
