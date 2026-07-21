import { useEffect, useRef, useState } from "react";
import type { VocabEntry } from "../types";
import { vocabCsv } from "./vocab";

interface Props {
  entries: VocabEntry[];
  onDelete: (id: string) => void;
  onClose: () => void;
}

// Right-side slide-over listing saved vocabulary, newest first. Not a
// modal: no overlay, no focus trap, the lyrics keep scrolling behind
// it. Escape or a click outside (except on the Vocab pill, which is a
// toggle and handles itself) dismisses it.
export default function VocabPanel({ entries, onDelete, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  );
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest("[data-vocab-toggle]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const flashCopyState = (state: "copied" | "failed") => {
    setCopyState(state);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState("idle"), 1500);
  };

  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(vocabCsv(entries));
      flashCopyState("copied");
    } catch {
      flashCopyState("failed");
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([vocabCsv(entries)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vocab.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      className="vocab-panel"
      role="dialog"
      aria-label="Saved vocabulary"
      ref={panelRef}
    >
      <div className="vocab-panel-head">
        <span className="vocab-panel-title">Vocab</span>
        <button
          className="vocab-action"
          onClick={copyCsv}
          disabled={entries.length === 0}
        >
          {copyState === "copied"
            ? "Copied"
            : copyState === "failed"
              ? "Copy failed"
              : "Copy CSV"}
        </button>
        <button
          className="vocab-action"
          onClick={downloadCsv}
          disabled={entries.length === 0}
        >
          Download CSV
        </button>
        <button
          className="vocab-close"
          aria-label="Close vocabulary panel"
          onClick={onClose}
        >
          close
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="vocab-empty">
          Nothing saved yet. Hover a Spanish word and hit Save in its gloss.
        </p>
      ) : (
        <ul className="vocab-list">
          {entries.map((e) => (
            <li key={e.id} className="vocab-row">
              <div className="vocab-row-head">
                <span className="vocab-word" lang="es">
                  {e.word}
                </span>
                {e.partOfSpeech && (
                  <span className="gloss-pos">{e.partOfSpeech}</span>
                )}
                <button
                  className="link-button vocab-delete"
                  aria-label={`Delete ${e.word}`}
                  onClick={() => onDelete(e.id)}
                >
                  delete
                </button>
              </div>
              <div className="vocab-gloss">{e.gloss}</div>
              {e.note && <div className="vocab-note">{e.note}</div>}
              <div className="vocab-context" lang="es">
                {e.contextLine}
              </div>
              {e.trackTitle && (
                <div className="vocab-track">{e.trackTitle}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
