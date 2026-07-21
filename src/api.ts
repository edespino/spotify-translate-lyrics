import type {
  MarkedTrack,
  TranslationEntry,
  VocabEntry,
  VocabInput,
} from "./types";

// Client for the local translation server. All calls go through the
// Vite dev proxy at /api.

// The server's guard for translating a marked track (409). Surfaced as
// its own type so the app can suppress the lyrics instead of showing a
// translation error.
export class TrackMarkedError extends Error {
  constructor() {
    super("Track marked wrong");
    this.name = "TrackMarkedError";
  }
}

export async function getTranslation(
  trackId: string
): Promise<TranslationEntry | null> {
  const res = await fetch(`/api/translations/${encodeURIComponent(trackId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function requestTranslation(
  trackId: string,
  title: string,
  artist: string,
  lines: string[],
  timesMs: number[],
  lrclibId?: number
): Promise<TranslationEntry> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, title, artist, lines, timesMs, lrclibId }),
  });
  if (res.status === 409) throw new TrackMarkedError();
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function saveOverride(
  trackId: string,
  lineIndex: number,
  field: "es" | "en",
  text: string
): Promise<TranslationEntry> {
  const res = await fetch("/api/override", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, lineIndex, field, text }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function resetOverride(
  trackId: string,
  lineIndex: number,
  field: "es" | "en"
): Promise<TranslationEntry> {
  const res = await fetch("/api/override/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId, lineIndex, field }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function listVocab(): Promise<VocabEntry[]> {
  const res = await fetch("/api/vocab");
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function saveVocab(
  input: VocabInput
): Promise<{ duplicate: boolean; entry: VocabEntry }> {
  const res = await fetch("/api/vocab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function deleteVocab(id: string): Promise<void> {
  const res = await fetch(`/api/vocab/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
}

// Wrong-lyrics marks: the server suppresses a marked track's lyrics
// and deletes its cached translation, so a reset re-fetches and
// re-translates fresh.
export interface MarkWrongInput {
  trackId: string;
  title: string;
  artist: string;
  lrclibId?: number;
}

export async function listMarks(): Promise<MarkedTrack[]> {
  const res = await fetch("/api/marks");
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function markLyrics(
  input: MarkWrongInput
): Promise<MarkedTrack> {
  const res = await fetch("/api/mark", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function resetMark(trackId: string): Promise<void> {
  const res = await fetch("/api/mark/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
}

export async function reportMark(trackId: string): Promise<void> {
  const res = await fetch("/api/mark/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
}

export async function retranslate(trackId: string): Promise<TranslationEntry> {
  const res = await fetch("/api/retranslate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId }),
  });
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}
