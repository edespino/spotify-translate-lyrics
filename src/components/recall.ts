// Pure logic for active-recall mode: the mode hides English translations
// so the listener tries to understand the Spanish first, revealing a
// line's translation on demand. Split out of LyricsView so mask
// eligibility, reveal-set behavior, the keyboard mapping, and the
// localStorage round trip are testable without a DOM.

import type { EnCellState } from "./lyricsRow";

export const RECALL_STORAGE_KEY = "recallMode";

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

// Off by default; only the exact stored "1" turns the mode on, so an
// unset or corrupted value never hides translations by surprise.
export function loadRecallMode(storage: StorageReader): boolean {
  return storage.getItem(RECALL_STORAGE_KEY) === "1";
}

export function saveRecallMode(storage: StorageWriter, on: boolean): void {
  storage.setItem(RECALL_STORAGE_KEY, on ? "1" : "0");
}

// Only a real translation is worth hiding: the loading skeleton, the
// failed-translation placeholder, and the empty instrumental placeholder
// carry nothing to recall, so they render unmasked even while the mode
// is on.
export function enCellMasked(
  recallOn: boolean,
  state: EnCellState,
  revealed: boolean,
  text: string | null
): boolean {
  return (
    recallOn && state === "text" && !revealed && (text ?? "").trim() !== ""
  );
}

// Reveals are scoped to one track: the set carries the trackId it was
// built for, and a different current track reads as no reveals at all.
export interface Reveals {
  trackId: string;
  indices: ReadonlySet<number>;
}

const NO_REVEALS: ReadonlySet<number> = new Set();

export function activeReveals(
  reveals: Reveals | null,
  trackId: string
): ReadonlySet<number> {
  if (!reveals || reveals.trackId !== trackId) return NO_REVEALS;
  return reveals.indices;
}

export function nextReveals(
  revealed: ReadonlySet<number>,
  index: number
): ReadonlySet<number> {
  const next = new Set(revealed);
  next.add(index);
  return next;
}

// Global "t" reveals the active line; modifier chords (browser and OS
// shortcuts) pass through untouched.
export function isRevealKey(
  key: string,
  metaKey: boolean,
  ctrlKey: boolean,
  altKey: boolean
): boolean {
  return key === "t" && !metaKey && !ctrlKey && !altKey;
}

// Revealing swaps the masked button for the plain cell mid-gesture, so
// the second click of a double-click lands on the revealed text. Within
// one double-click window after a reveal, follow-up gestures on that
// line (row enlarge, cell edit) are swallowed: the first gesture on a
// masked cell only ever reveals.
const REVEAL_GESTURE_WINDOW_MS = 500;

export interface RevealMark {
  index: number;
  time: number;
}

export function suppressAfterReveal(
  lastReveal: RevealMark | null,
  index: number,
  time: number
): boolean {
  return (
    lastReveal !== null &&
    lastReveal.index === index &&
    time - lastReveal.time < REVEAL_GESTURE_WINDOW_MS
  );
}
