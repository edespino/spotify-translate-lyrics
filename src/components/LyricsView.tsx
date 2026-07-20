import { useEffect, useRef, useState } from "react";
import type { TranslationState } from "../App";
import type { LyricsResult } from "../types";

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
}

interface Row {
  es: string;
  en: string | null;
  editedEs: boolean;
  editedEn: boolean;
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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [editing, setEditing] = useState<{ index: number; field: Field } | null>(
    null
  );

  const entry = translation.status === "ready" ? translation.entry : null;
  const sourceTexts =
    lyrics.kind === "synced" ? lyrics.lines.map((l) => l.text) : lyrics.lines;

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
    if (activeIndex < 0) return;
    const container = containerRef.current;
    const row = container?.querySelector<HTMLElement>(
      `[data-row="${activeIndex}"]`
    );
    if (!container || !row) return;
    container.scrollTo({
      top: row.offsetTop - container.clientHeight / 2 + row.offsetHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex]);

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
          <div className="lyrics-grid">
            {sourceTexts.map((text, i) => (
              <div
                key={i}
                data-row={i}
                className={[
                  "lyric-row",
                  lyrics.kind === "synced" && i === activeIndex ? "active" : "",
                  i === focusedIndex ? "focused" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setFocusedIndex(i === focusedIndex ? -1 : i)}
              >
                <div className="lyric-cell">{text || "♪"}</div>
              </div>
            ))}
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
          onSave={(value) => {
            setEditing(null);
            onEdit(i, field, value);
          }}
          onCancel={() => setEditing(null)}
        />
      );
    }
    return (
      <span className="cell-text" onDoubleClick={() => startEdit(i, field)}>
        {text === null ? (
          <span className="pending">...</span>
        ) : (
          text || "♪"
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
              server unavailable{" "}
              <button className="link-button" onClick={onRetryTranslation}>
                retry
              </button>
            </span>
          )}
          {translation.status === "loading" && (
            <span className="pending">translating...</span>
          )}
        </div>
      </div>
      <div className="lyrics-scroll" ref={containerRef}>
        <div className="lyrics-grid">
          {rows.map((row, i) => (
            <div
              key={i}
              data-row={i}
              className={[
                "lyric-row",
                lyrics.kind === "synced" && i === activeIndex ? "active" : "",
                i === focusedIndex ? "focused" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setFocusedIndex(i === focusedIndex ? -1 : i)}
            >
              <div className="lyric-cell">{cell(row, i, "es")}</div>
              <div className="lyric-cell">{cell(row, i, "en")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EditCell({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      className="edit-input"
      autoFocus
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
