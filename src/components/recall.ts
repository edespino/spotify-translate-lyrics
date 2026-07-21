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

// localStorage can be entirely unavailable (storage disabled, some
// private modes): even reading window.localStorage throws a
// SecurityError there, so the default is resolved lazily inside a
// try/catch rather than at the call site.
function defaultStorage(): (StorageReader & StorageWriter) | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Off by default; only the exact stored "1" turns the mode on, so an
// unset, corrupted, or unreadable value never hides translations by
// surprise.
export function loadRecallMode(
  storage: StorageReader | null = defaultStorage()
): boolean {
  try {
    return storage?.getItem(RECALL_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Persistence is best-effort: a write failure only costs the preference
// surviving a reload, never the session.
export function saveRecallMode(
  on: boolean,
  storage: StorageWriter | null = defaultStorage()
): void {
  try {
    storage?.setItem(RECALL_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Ignored: the mode still toggles for this session.
  }
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

// State machine for the mask button across a revealing gesture. The
// first gesture on a masked cell only ever reveals, so the button stays
// mounted (unblurred) after the reveal and the remaining events of that
// same gesture (the second click and dblclick of a double-click, which
// carry the browser's multi-click counter detail >= 2) land on it and
// are swallowed. A click with detail <= 1 is by definition a fresh
// gesture: it releases the mask (the plain cell takes over) and passes
// through so the row enlarges as usual. Gesture membership comes from
// event.detail, never wall-clock time.
export type MaskPhase = "masked" | "tail";

export interface MaskGestureStep {
  action: "reveal" | "swallow" | "pass";
  phase: MaskPhase | "released";
}

export function maskGesture(
  phase: MaskPhase,
  type: "click" | "dblclick",
  detail: number
): MaskGestureStep {
  if (phase === "masked") {
    // A dblclick cannot arrive first (its click precedes it); swallowed
    // defensively so it can never reach the row.
    if (type === "dblclick") return { action: "swallow", phase: "masked" };
    return { action: "reveal", phase: "tail" };
  }
  if (type === "dblclick") return { action: "swallow", phase: "released" };
  return detail >= 2
    ? { action: "swallow", phase: "tail" }
    : { action: "pass", phase: "released" };
}
