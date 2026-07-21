// Pure per-row presentation logic for LyricsView, split out so it is
// testable without a DOM: temporal classification (past/active/upcoming),
// English cell state, keyboard actions, and scroll behavior selection.

export type RowPhase = "past" | "active" | "upcoming";

export function rowPhase(
  index: number,
  activeIndex: number,
  synced: boolean
): RowPhase {
  if (!synced || activeIndex < 0) return "upcoming";
  if (index === activeIndex) return "active";
  return index < activeIndex ? "past" : "upcoming";
}

export function rowClassName(phase: RowPhase, focused: boolean): string {
  const classes = ["lyric-row"];
  if (phase === "active") classes.push("active");
  if (phase === "past") classes.push("past");
  if (focused) classes.push("focused");
  return classes.join(" ");
}

export type EnCellState = "text" | "pending" | "error";

// A null translation renders a skeleton bar while a translation may
// still arrive, but a dim placeholder once the translation has failed,
// so an error never looks like loading.
export function enCellState(
  en: string | null,
  translationStatus: string
): EnCellState {
  if (en !== null) return "text";
  return translationStatus === "error" ? "error" : "pending";
}

export type RowKeyAction = "toggle" | "edit" | "replay" | null;

export function rowKeyAction(key: string): RowKeyAction {
  if (key === "Enter") return "toggle";
  if (key === "F2" || key === "e") return "edit";
  if (key === "r") return "replay";
  return null;
}

// Replay needs a timestamp to seek to and an audible lyric to hear:
// plain (unsynced) rows have no timestamp and instrumental placeholder
// rows (the musical note) have no text.
export function replayEligible(timeMs: number | null, text: string): boolean {
  return timeMs !== null && text.trim() !== "";
}

// Guards the global "r" shortcut so it never fires while typing in the
// edit input (or any other text control).
export function isTypingTarget(
  tagName: string | undefined,
  isContentEditable: boolean
): boolean {
  if (isContentEditable) return true;
  const tag = (tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

// Long jumps (seeks) snap instead of animating the whole list past the
// viewport; reduced motion always snaps.
export function scrollBehavior(
  distance: number,
  viewportHeight: number,
  reducedMotion: boolean
): "auto" | "smooth" {
  if (reducedMotion) return "auto";
  return Math.abs(distance) > viewportHeight * 1.5 ? "auto" : "smooth";
}
