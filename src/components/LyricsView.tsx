import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TranslationState } from "../App";
import type { LyricsResult } from "../types";
import type { GlossEntry } from "../gloss";
import { GlossInvalidError, fetchGloss, isAbortError } from "../gloss";
import { vocabKey } from "./vocab";
import {
  GLOSS_ERROR_MS,
  GLOSS_GAP,
  GLOSS_HOVER_MS,
  glossEligible,
  glossHoverStep,
  type GlossHoverEvent,
  glossPopoverNext,
  glossPopoverPosition,
  isGlossClick,
  segmentLine,
  type GlossAnchor,
  type GlossPopoverEvent,
  type GlossPopoverState,
} from "./gloss";
import { skeletonWidth } from "./stateScreen";
import {
  enCellState,
  isTypingTarget,
  replayEligible,
  rowClassName,
  rowKeyAction,
  rowPhase,
  scrollBehavior,
} from "./lyricsRow";
import {
  activeReveals,
  enCellMasked,
  isRevealKey,
  loadRecallMode,
  maskGesture,
  nextReveals,
  saveRecallMode,
  type MaskPhase,
} from "./recall";

type Field = "es" | "en";

interface Props {
  lyrics: Extract<LyricsResult, { kind: "synced" | "plain" }>;
  trackId: string;
  english: boolean;
  translation: TranslationState;
  activeIndex: number;
  onEdit: (lineIndex: number, field: Field, text: string) => void;
  onResetLine: (lineIndex: number, field: Field) => void;
  onRetranslate: () => void;
  onRetryTranslation: () => void;
  onReplay: (timeMs: number) => void;
  savedGlossKeys: ReadonlySet<string>;
  onSaveGloss: (entry: GlossEntry, contextLine: string) => void;
}

// Fraction of the pane height where the active line is anchored. Upper
// third (Spotify-like) rather than dead center: the smooth scroll from
// the top-anchored intro state to the first active line stays short,
// and more upcoming lines remain visible below the active one.
const ACTIVE_ANCHOR = 0.32;

interface Row {
  es: string;
  en: string | null;
  editedEs: boolean;
  editedEn: boolean;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Both languages render inside one scroll container as grid rows, so
// the Spanish and English lines always stay vertically aligned and
// scroll together, one pane per column.
export default function LyricsView({
  lyrics,
  trackId,
  english,
  translation,
  activeIndex,
  onEdit,
  onResetLine,
  onRetranslate,
  onRetryTranslation,
  onReplay,
  savedGlossKeys,
  onSaveGloss,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [editing, setEditing] = useState<{ index: number; field: Field } | null>(
    null
  );
  // Active-recall mode: hide English translations until the listener
  // reveals a line. The mode itself persists in localStorage; reveals
  // are per track (activeReveals reads as empty once trackId changes).
  // tail is the line whose mask button is still mounted after a pointer
  // reveal, swallowing the rest of that same gesture; it lives inside
  // the reveals object so a track change clears it with the reveals.
  const [recallOn, setRecallOn] = useState(() => loadRecallMode());
  const [reveals, setReveals] = useState<{
    trackId: string;
    indices: ReadonlySet<number>;
    tail: number | null;
  } | null>(null);

  // Word gloss popover: hover a Spanish word (or alt-click it) for a
  // concise English gloss of that word in its line. One popover at a
  // time; the anchor is in the scroll container's coordinate space so
  // the popover scrolls with the lyrics. Timers: hover delay before
  // opening, a short grace period when leaving word or popover (so the
  // pointer can travel between them), and the brief error notice.
  const [gloss, setGloss] = useState<{
    state: NonNullable<GlossPopoverState>;
    anchor: GlossAnchor;
  } | null>(null);
  const glossAbortRef = useRef<AbortController | null>(null);
  const glossPopoverRef = useRef<HTMLDivElement>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const errorTimerRef = useRef<number | null>(null);

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      ref.current = null;
    }
  };

  const applyGlossEvent = (event: GlossPopoverEvent) =>
    setGloss((g) => {
      const next = glossPopoverNext(g?.state ?? null, event);
      if (next === null) return null;
      if (!g || next === g.state) return g;
      return { ...g, state: next };
    });

  const dismissGloss = () => {
    glossAbortRef.current?.abort();
    glossAbortRef.current = null;
    clearTimer(hoverTimerRef);
    clearTimer(leaveTimerRef);
    clearTimer(errorTimerRef);
    setGloss(null);
  };

  const openGloss = (word: string, context: string, el: HTMLElement) => {
    const container = containerRef.current;
    if (!container || !el.isConnected) return;
    clearTimer(hoverTimerRef);
    clearTimer(leaveTimerRef);
    clearTimer(errorTimerRef);
    glossAbortRef.current?.abort();
    const controller = new AbortController();
    glossAbortRef.current = controller;
    const cRect = container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const anchor: GlossAnchor = {
      left: rect.left - cRect.left + container.scrollLeft,
      top: rect.top - cRect.top + container.scrollTop,
      bottom: rect.bottom - cRect.top + container.scrollTop,
    };
    setGloss({ state: { status: "loading", word, context }, anchor });
    fetchGloss(word, context, controller.signal).then(
      (entry) => applyGlossEvent({ type: "loaded", word, context, entry }),
      (err) => {
        if (isAbortError(err)) return;
        if (err instanceof GlossInvalidError) {
          applyGlossEvent({ type: "invalid", word, context });
          return;
        }
        applyGlossEvent({ type: "failed", word, context });
        errorTimerRef.current = window.setTimeout(() => {
          errorTimerRef.current = null;
          setGloss((g) => (g && g.state.status === "error" ? null : g));
        }, GLOSS_ERROR_MS);
      }
    );
  };

  // Pointer choreography (which timers start and stop on each enter and
  // leave) is the pure glossHoverStep mapping; this just executes its
  // actions against the two timer refs.
  const runHoverStep = (
    event: GlossHoverEvent,
    open?: { word: string; context: string; el: HTMLElement }
  ) => {
    const actions = glossHoverStep(event);
    if (actions.cancelOpen) clearTimer(hoverTimerRef);
    if (actions.cancelLeave) clearTimer(leaveTimerRef);
    if (actions.startOpen && open) {
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        openGloss(open.word, open.context, open.el);
      }, GLOSS_HOVER_MS);
    }
    if (actions.startLeave) {
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null;
        dismissGloss();
      }, 120);
    }
  };

  const wordEnter = (word: string, context: string, el: HTMLElement) =>
    runHoverStep(
      {
        type: "enterWord",
        sameAsOpen:
          gloss !== null &&
          gloss.state.word === word &&
          gloss.state.context === context,
      },
      { word, context, el }
    );

  const wordLeave = () =>
    runHoverStep({ type: "leaveWord", popoverOpen: gloss !== null });

  // Escape and scrolling the lyrics container both dismiss the popover.
  const glossOpen = gloss !== null;
  useEffect(() => {
    if (!glossOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissGloss();
    };
    const container = containerRef.current;
    window.addEventListener("keydown", onKey);
    container?.addEventListener("scroll", dismissGloss);
    return () => {
      window.removeEventListener("keydown", onKey);
      container?.removeEventListener("scroll", dismissGloss);
    };
  }, [glossOpen]);

  // Track change dismisses the popover (and cancels its pending fetch).
  useEffect(() => {
    return () => dismissGloss();
  }, [trackId]);

  // Position with the popover's real size once it is in the DOM: below
  // the word, flipped above when the bottom of the pane is too close,
  // clamped inside the container. useLayoutEffect runs before paint, so
  // the initial anchor-based style is never visible.
  useLayoutEffect(() => {
    const node = glossPopoverRef.current;
    const container = containerRef.current;
    if (!node || !container || !gloss) return;
    const pos = glossPopoverPosition(
      gloss.anchor,
      { width: node.offsetWidth, height: node.offsetHeight },
      {
        scrollTop: container.scrollTop,
        clientWidth: container.clientWidth,
        clientHeight: container.clientHeight,
      }
    );
    node.style.left = `${pos.left}px`;
    node.style.top = `${pos.top}px`;
  }, [gloss]);

  // The loaded gloss, narrowed once so the Save button's click handler
  // (a callback, where TS narrowing of gloss.state does not survive)
  // can use it directly. Saved-ness comes from the vocab list the app
  // loaded, keyed the same way the server dedupes.
  const glossReady =
    gloss !== null && gloss.state.status === "ready" ? gloss.state : null;
  const glossSaved =
    glossReady !== null &&
    savedGlossKeys.has(vocabKey(glossReady.entry.word, glossReady.context));

  const revealedSet = activeReveals(reveals, trackId);
  const tailIndex =
    reveals && reveals.trackId === trackId ? reveals.tail : null;

  const revealLine = (i: number, viaPointer: boolean) =>
    setReveals({
      trackId,
      indices: nextReveals(revealedSet, i),
      tail: viaPointer ? i : null,
    });

  const releaseTail = () =>
    setReveals((r) => (r && r.tail !== null ? { ...r, tail: null } : r));

  const toggleRecall = () => {
    const next = !recallOn;
    setRecallOn(next);
    saveRecallMode(next);
    // Toggling off and on starts a fresh recall pass over the track.
    setReveals(null);
  };

  const entry = translation.status === "ready" ? translation.entry : null;
  const sourceTexts =
    lyrics.kind === "synced" ? lyrics.lines.map((l) => l.text) : lyrics.lines;
  const synced = lyrics.kind === "synced";
  const times =
    lyrics.kind === "synced" ? lyrics.lines.map((l) => l.timeMs) : null;

  // Timestamp to replay row i from, or null when the row has no replay
  // affordance (plain lyrics, or an instrumental placeholder line).
  const replayTime = (i: number): number | null =>
    times && replayEligible(times[i], sourceTexts[i]) ? times[i] : null;

  const replayButton = (i: number) => {
    const t = replayTime(i);
    if (t === null) return null;
    return (
      <button
        className="replay-button"
        aria-label="replay this line"
        onClick={(e) => {
          e.stopPropagation();
          onReplay(t);
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M8 2a6 6 0 1 1-5.9 7.1h1.7A4.4 4.4 0 1 0 8 3.6V6L3.8 3 8 0v2z"
            fill="currentColor"
          />
        </svg>
      </button>
    );
  };

  const rows: Row[] = sourceTexts.map((text, i) => {
    const line = entry?.lines[i];
    return {
      es: line ? line.editedEs ?? line.es : text,
      en: line ? line.editedEn ?? line.en : null,
      editedEs: line?.editedEs !== undefined,
      editedEn: line?.editedEn !== undefined,
    };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (activeIndex < 0) {
      // No active line yet (intro, or plain unsynced lyrics): rest at the
      // natural top so the first line sits at the top of the pane.
      container.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    const row = container.querySelector<HTMLElement>(
      `[data-row="${activeIndex}"]`
    );
    if (!row) return;
    // row.offsetTop is in the container's scroll space because
    // .lyrics-scroll is position: relative; scrollTop shares that origin.
    // Clamp at 0 so early active lines highlight in place while the list
    // stays top-anchored; smooth scrolling engages once a line would sit
    // below the anchor.
    const top = Math.max(
      0,
      row.offsetTop +
        row.offsetHeight / 2 -
        container.clientHeight * ACTIVE_ANCHOR
    );
    container.scrollTo({
      top,
      behavior: scrollBehavior(
        top - container.scrollTop,
        container.clientHeight,
        prefersReducedMotion()
      ),
    });
  }, [activeIndex, lyrics]);

  // Global "t": reveal the active line's translation. Same guards as the
  // global replay shortcut: never while typing, no modifier chords.
  const activeEn = activeIndex >= 0 ? rows[activeIndex]?.en ?? null : null;
  useEffect(() => {
    if (english || !recallOn || activeIndex < 0) return;
    if (
      !enCellMasked(
        recallOn,
        enCellState(activeEn, translation.status),
        revealedSet.has(activeIndex),
        activeEn
      )
    )
      return;
    const onKey = (e: KeyboardEvent) => {
      if (!isRevealKey(e.key, e.metaKey, e.ctrlKey, e.altKey)) return;
      const target = e.target as HTMLElement | null;
      if (isTypingTarget(target?.tagName, target?.isContentEditable ?? false))
        return;
      e.preventDefault();
      revealLine(activeIndex, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    english,
    recallOn,
    activeIndex,
    activeEn,
    translation.status,
    revealedSet,
    trackId,
  ]);

  const toggleFocus = (i: number) =>
    setFocusedIndex(i === focusedIndex ? -1 : i);

  // English lyrics: one centered full-width pane, read-only. Same synced
  // scrolling, active-line highlight, and click-to-enlarge as the dual
  // view, but no translation column and no edit affordances.
  if (english) {
    return (
      <div className="lyrics-view single">
        <div className="pane-headers single">
          <div className="pane-header">
            <span>English</span>
          </div>
        </div>
        <div className="lyrics-scroll" ref={containerRef}>
          <div className="lyrics-grid" role="list">
            {sourceTexts.map((text, i) => {
              const phase = rowPhase(i, activeIndex, synced);
              return (
                <div
                  key={i}
                  data-row={i}
                  role="listitem"
                  tabIndex={0}
                  aria-current={phase === "active" ? "true" : undefined}
                  className={rowClassName(phase, i === focusedIndex)}
                  onClick={() => toggleFocus(i)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    const action = rowKeyAction(e.key);
                    if (action === "toggle") {
                      e.preventDefault();
                      toggleFocus(i);
                    } else if (action === "replay") {
                      e.preventDefault();
                      e.stopPropagation();
                      const t = replayTime(i);
                      if (t !== null) onReplay(t);
                    }
                  }}
                >
                  {replayButton(i)}
                  <div className="lyric-cell" lang="en">
                    {text || <span className="note">♪</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const startEdit = (index: number, field: Field) => {
    if (field === "en" && rows[index].en === null) return;
    // The edit input replaces the word spans, so any popover anchored to
    // them (a double-clicked gloss word) goes too.
    dismissGloss();
    setEditing({ index, field });
  };

  const cell = (row: Row, i: number, field: Field) => {
    const text = field === "es" ? row.es : row.en;
    const edited = field === "es" ? row.editedEs : row.editedEn;
    if (editing && editing.index === i && editing.field === field) {
      return (
        <EditCell
          initial={text ?? ""}
          label={`Edit ${field === "es" ? "Spanish" : "English"} line ${i + 1}`}
          onSave={(value) => {
            setEditing(null);
            onEdit(i, field, value);
          }}
          onCancel={() => setEditing(null)}
        />
      );
    }
    const state = field === "en" ? enCellState(row.en, translation.status) : "text";
    const masked =
      field === "en" && enCellMasked(recallOn, state, revealedSet.has(i), row.en);
    const tail =
      field === "en" &&
      recallOn &&
      state === "text" &&
      tailIndex === i &&
      revealedSet.has(i);
    if (masked || tail) {
      // The mask is a button: focusable, Enter/Space reveal for free, and
      // its own click target so clicking the masked cell only reveals and
      // never enlarges the row. The blurred text keeps the cell's natural
      // height so column alignment and scrolling are untouched. After a
      // pointer reveal the button stays mounted (unblurred, the tail
      // phase) so the rest of that same gesture is swallowed by
      // maskGesture; a fresh click passes through to enlarge and swaps in
      // the plain cell, as do leaving or blurring the button.
      const phase: MaskPhase = masked ? "masked" : "tail";
      const step = (
        e: { stopPropagation(): void; detail: number },
        type: "click" | "dblclick"
      ) => {
        const s = maskGesture(phase, type, e.detail);
        if (s.action !== "pass") e.stopPropagation();
        if (s.action === "reveal") revealLine(i, true);
        else if (s.phase === "released") releaseTail();
      };
      return (
        <button
          className={masked ? "masked-cell" : "masked-cell revealed"}
          aria-label={
            masked ? "translation hidden, click to reveal" : undefined
          }
          onClick={(e) => step(e, "click")}
          onDoubleClick={(e) => step(e, "dblclick")}
          onMouseLeave={masked ? undefined : releaseTail}
          onBlur={masked ? undefined : releaseTail}
        >
          <span
            className={masked ? "masked-text" : "masked-text revealed"}
            aria-hidden={masked ? "true" : undefined}
          >
            {row.en}
          </span>
        </button>
      );
    }
    return (
      <span
        className={
          field === "en" && recallOn && revealedSet.has(i)
            ? "cell-text revealed"
            : "cell-text"
        }
        onDoubleClick={() => startEdit(i, field)}
      >
        {state === "pending" ? (
          <span className="skeleton" style={{ width: skeletonWidth(i) }} />
        ) : state === "error" ? (
          <span className="en-missing">-</span>
        ) : glossEligible(english, field, false, text ?? "") ? (
          <GlossableLine
            text={text ?? ""}
            onWordEnter={wordEnter}
            onWordLeave={wordLeave}
            onWordAltClick={openGloss}
          />
        ) : (
          text || <span className="note">♪</span>
        )}
        {edited && (
          <span className="edited-marks">
            <span className="edited-marker" title="edited">
              *
            </span>
            <button
              className="link-button"
              title="reset to original"
              onClick={(e) => {
                e.stopPropagation();
                onResetLine(i, field);
              }}
            >
              reset
            </button>
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="lyrics-view">
      <div className="pane-headers">
        <div className="pane-header">
          <span>Español</span>
        </div>
        <div className="pane-header">
          <span>English</span>
          <button
            className={recallOn ? "recall-toggle on" : "recall-toggle"}
            aria-pressed={recallOn}
            title="Hide translations until revealed"
            onClick={toggleRecall}
          >
            Recall
          </button>
          {translation.status === "ready" && (
            <button className="link-button" onClick={onRetranslate}>
              retranslate all
            </button>
          )}
          {translation.status === "error" && (
            <span className="translation-error">
              translation failed
              <button className="retry-button" onClick={onRetryTranslation}>
                Retry translation
              </button>
            </span>
          )}
          {translation.status === "loading" && (
            <span className="pending">translating...</span>
          )}
        </div>
      </div>
      <div className="lyrics-scroll" ref={containerRef}>
        <div className="lyrics-grid" role="list">
          {rows.map((row, i) => {
            const phase = rowPhase(i, activeIndex, synced);
            return (
              <div
                key={i}
                data-row={i}
                role="listitem"
                tabIndex={0}
                aria-current={phase === "active" ? "true" : undefined}
                className={rowClassName(phase, i === focusedIndex)}
                onClick={() => toggleFocus(i)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  const action = rowKeyAction(e.key);
                  if (!action) return;
                  e.preventDefault();
                  if (action === "toggle") toggleFocus(i);
                  else if (action === "edit") startEdit(i, "es");
                  else {
                    // Stop the global "r" handler from also replaying
                    // the active line.
                    e.stopPropagation();
                    const t = replayTime(i);
                    if (t !== null) onReplay(t);
                  }
                }}
              >
                {replayButton(i)}
                <div className="lyric-cell" lang="es">
                  {cell(row, i, "es")}
                </div>
                <div className="lyric-cell" lang="en">
                  {cell(row, i, "en")}
                </div>
              </div>
            );
          })}
        </div>
        {gloss && (
          <div
            className="gloss-popover"
            role="tooltip"
            ref={glossPopoverRef}
            style={{
              left: gloss.anchor.left,
              top: gloss.anchor.bottom + GLOSS_GAP,
            }}
            onMouseEnter={() => runHoverStep({ type: "enterPopover" })}
            onMouseLeave={() => runHoverStep({ type: "leavePopover" })}
          >
            {gloss.state.status === "loading" ? (
              <span className="skeleton gloss-skeleton" />
            ) : gloss.state.status === "error" ? (
              <span className="gloss-missing">no gloss available</span>
            ) : (
              <>
                <div className="gloss-head">
                  <span className="gloss-term" lang="es">
                    {gloss.state.entry.word}
                  </span>
                  {gloss.state.entry.partOfSpeech && (
                    <span className="gloss-pos">
                      {gloss.state.entry.partOfSpeech}
                    </span>
                  )}
                </div>
                <div className="gloss-def">{gloss.state.entry.gloss}</div>
                {gloss.state.entry.note && (
                  <div className="gloss-note">{gloss.state.entry.note}</div>
                )}
                <button
                  className={glossSaved ? "gloss-save saved" : "gloss-save"}
                  disabled={glossSaved}
                  onClick={() => {
                    if (glossReady) {
                      onSaveGloss(glossReady.entry, glossReady.context);
                    }
                  }}
                >
                  {glossSaved ? "Saved" : "Save"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// A Spanish line rendered as its exact text, with each word wrapped in
// an inline span that is a gloss hover and alt-click target. Word spans
// are not in the tab order (rows already carry focus semantics; gloss
// is pointer-first). Plain click and double-click bubble to the row's
// enlarge and edit behavior; only alt-click is claimed.
function GlossableLine({
  text,
  onWordEnter,
  onWordLeave,
  onWordAltClick,
}: {
  text: string;
  onWordEnter: (word: string, context: string, el: HTMLElement) => void;
  onWordLeave: () => void;
  onWordAltClick: (word: string, context: string, el: HTMLElement) => void;
}) {
  const tokens = useMemo(() => segmentLine(text), [text]);
  return (
    <>
      {tokens.map((token, k) =>
        token.isWord ? (
          <span
            key={k}
            className="gloss-word"
            onMouseEnter={(e) => onWordEnter(token.text, text, e.currentTarget)}
            onMouseLeave={onWordLeave}
            onClick={(e) => {
              if (!isGlossClick(e.altKey, e.metaKey, e.ctrlKey)) return;
              e.preventDefault();
              e.stopPropagation();
              onWordAltClick(token.text, text, e.currentTarget);
            }}
          >
            {token.text}
          </span>
        ) : (
          <Fragment key={k}>{token.text}</Fragment>
        )
      )}
    </>
  );
}

function EditCell({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string;
  label: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="edit-input"
      autoFocus
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSave(value);
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
