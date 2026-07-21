// Pure logic for word glossing: hovering (or alt-clicking) a Spanish
// word shows a small popover with a concise English gloss of that word
// as used in the line. Split out of LyricsView so segmentation, the
// popover state machine, gesture eligibility, and popover placement are
// testable without a DOM.

import type { GlossEntry } from "../gloss";

// How long the pointer rests on a word before the popover opens.
export const GLOSS_HOVER_MS = 450;

// How long the "no gloss available" notice stays before auto-dismissing.
export const GLOSS_ERROR_MS = 1600;

// A line split into word and non-word runs that concatenate back to the
// exact original string, so rendering tokens instead of the raw text
// changes nothing visually: whitespace and punctuation stay as plain
// text, only word runs become hover targets.
export interface LineToken {
  text: string;
  isWord: boolean;
}

interface WordSegmenter {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
}

function makeSegmenter(): WordSegmenter | null {
  try {
    if (typeof Intl.Segmenter !== "function") return null;
    return new Intl.Segmenter("es", { granularity: "word" });
  } catch {
    return null;
  }
}

// Fallback when Intl.Segmenter is unavailable: a word is a run of
// letters, combining marks (decomposed accents), or digits, so accented
// characters and the n-tilde stay inside their word.
export function segmentLineFallback(line: string): LineToken[] {
  const tokens: LineToken[] = [];
  const re = /[\p{L}\p{M}\p{N}]+/gu;
  let last = 0;
  for (const match of line.matchAll(re)) {
    const start = match.index;
    if (start > last) tokens.push({ text: line.slice(last, start), isWord: false });
    tokens.push({ text: match[0], isWord: true });
    last = start + match[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last), isWord: false });
  return tokens;
}

export function segmentLine(
  line: string,
  segmenter: WordSegmenter | null = makeSegmenter()
): LineToken[] {
  if (!segmenter) return segmentLineFallback(line);
  const tokens: LineToken[] = [];
  for (const part of segmenter.segment(line)) {
    tokens.push({ text: part.segment, isWord: part.isWordLike === true });
  }
  return tokens;
}

// Gloss targets exist only where there is a Spanish word to learn: the
// Spanish cell of the dual-pane view, outside the edit input, on a line
// with text (never the empty instrumental placeholder). English
// single-pane mode has nothing to gloss.
export function glossEligible(
  english: boolean,
  field: "es" | "en",
  editing: boolean,
  text: string
): boolean {
  return !english && field === "es" && !editing && text.trim() !== "";
}

// Alt-click opens the gloss immediately; anything else (plain click,
// double-click, other chords) passes through to the row's enlarge and
// edit behavior untouched.
export function isGlossClick(
  altKey: boolean,
  metaKey: boolean,
  ctrlKey: boolean
): boolean {
  return altKey && !metaKey && !ctrlKey;
}

// Popover state machine. A result event (loaded/failed/invalid) applies
// only while still loading that same word and context, so a late
// response for a dismissed or replaced popover never renders. Opening
// always replaces whatever is showing: one popover at a time.
export type GlossPopoverState =
  | { status: "loading"; word: string; context: string }
  | { status: "ready"; word: string; context: string; entry: GlossEntry }
  | { status: "error"; word: string; context: string }
  | null;

export type GlossPopoverEvent =
  | { type: "open"; word: string; context: string }
  | { type: "loaded"; word: string; context: string; entry: GlossEntry }
  | { type: "failed"; word: string; context: string }
  | { type: "invalid"; word: string; context: string }
  | { type: "dismiss" };

function matchesLoading(
  state: GlossPopoverState,
  word: string,
  context: string
): state is Extract<GlossPopoverState, { status: "loading" }> {
  return (
    state !== null &&
    state.status === "loading" &&
    state.word === word &&
    state.context === context
  );
}

export function glossPopoverNext(
  state: GlossPopoverState,
  event: GlossPopoverEvent
): GlossPopoverState {
  switch (event.type) {
    case "open":
      return { status: "loading", word: event.word, context: event.context };
    case "loaded":
      if (!matchesLoading(state, event.word, event.context)) return state;
      return {
        status: "ready",
        word: event.word,
        context: event.context,
        entry: event.entry,
      };
    case "failed":
      if (!matchesLoading(state, event.word, event.context)) return state;
      return { status: "error", word: event.word, context: event.context };
    case "invalid":
      if (!matchesLoading(state, event.word, event.context)) return state;
      return null;
    case "dismiss":
      return null;
  }
}

// Placement in the scroll container's coordinate space (the popover is
// position: absolute inside it, so it scrolls with the lyrics). Below
// the word by default, flipped above when that would fall past the
// bottom of the visible pane, and clamped horizontally so it never
// overflows the container.
export const GLOSS_GAP = 6;
const GLOSS_MARGIN = 8;

export interface GlossAnchor {
  left: number;
  top: number;
  bottom: number;
}

export function glossPopoverPosition(
  anchor: GlossAnchor,
  size: { width: number; height: number },
  view: { scrollTop: number; clientWidth: number; clientHeight: number }
): { left: number; top: number } {
  const maxLeft = view.clientWidth - size.width - GLOSS_MARGIN;
  const left = Math.max(GLOSS_MARGIN, Math.min(anchor.left, maxLeft));
  let top = anchor.bottom + GLOSS_GAP;
  if (top + size.height > view.scrollTop + view.clientHeight - GLOSS_MARGIN) {
    top = anchor.top - size.height - GLOSS_GAP;
  }
  return { left, top };
}
