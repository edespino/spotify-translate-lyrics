import { useEffect, useRef, useState } from "react";
import type { TranslationState } from "../App";
import type { LyricsResult } from "../types";
import { skeletonWidth } from "./stateScreen";
import {
  enCellState,
  replayEligible,
  rowClassName,
  rowKeyAction,
  rowPhase,
  scrollBehavior,
} from "./lyricsRow";

type Field = "es" | "en";

interface Props {
  lyrics: Extract<LyricsResult, { kind: "synced" | "plain" }>;
  english: boolean;
  translation: TranslationState;
  activeIndex: number;
  onEdit: (lineIndex: number, field: Field, text: string) => void;
  onResetLine: (lineIndex: number, field: Field) => void;
  onRetranslate: () => void;
  onRetryTranslation: () => void;
  onReplay: (timeMs: number) => void;
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
  english,
  translation,
  activeIndex,
  onEdit,
  onResetLine,
  onRetranslate,
  onRetryTranslation,
  onReplay,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [editing, setEditing] = useState<{ index: number; field: Field } | null>(
    null
  );

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
    return (
      <span className="cell-text" onDoubleClick={() => startEdit(i, field)}>
        {state === "pending" ? (
          <span className="skeleton" style={{ width: skeletonWidth(i) }} />
        ) : state === "error" ? (
          <span className="en-missing">-</span>
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
      </div>
    </div>
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
