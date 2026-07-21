import { useEffect, useState } from "react";
import {
  EMPTY_SELECTION,
  canSaveLines,
  deleteSelected,
  detectPasteKind,
  formatTimestamp,
  parsePaste,
  setLineText,
  toggleSelection,
  type EditorLine,
} from "./lyricsEditing";

interface Props {
  title: string;
  artist: string;
  initialLines: EditorLine[];
  sourceUrl: string;
  hasOverride: boolean;
  onSave: (lines: EditorLine[]) => void;
  onRestore: () => void;
  onCancel: () => void;
}

// Full-pane lyrics correction editor. It replaces the lyrics view while
// open (App renders one or the other), so the lyric gestures and global
// shortcuts (r/t/e/F2/Enter) have nothing to fire on; the editor's own
// inputs are ordinary typing targets. Escape closes without saving;
// Save and Cancel are explicit.
export default function LyricsEditor({
  title,
  artist,
  initialLines,
  sourceUrl,
  hasOverride,
  onSave,
  onRestore,
  onCancel,
}: Props) {
  const [lines, setLines] = useState<EditorLine[]>(initialLines);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  // A marked track opens with no lyrics loaded, so paste-replace is the
  // only way in; otherwise the line list is the default view.
  const [pasteOpen, setPasteOpen] = useState(initialLines.length === 0);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const selectedCount = selection.indices.size;
  const pasteKind = pasteText.trim() ? detectPasteKind(pasteText) : null;

  const applyPaste = () => {
    setLines(parsePaste(pasteText));
    setSelection(EMPTY_SELECTION);
    setPasteText("");
    setPasteOpen(false);
  };

  return (
    <div className="lyrics-editor" role="dialog" aria-label="Edit lyrics">
      <div className="editor-head">
        <div className="editor-title-block">
          <span className="editor-heading">Edit lyrics</span>
          <span className="editor-track">
            {title} <span className="editor-artist">{artist}</span>
          </span>
          <a
            className="source-link"
            href={sourceUrl}
            target="_blank"
            rel="noopener"
          >
            LRCLIB source
          </a>
        </div>
        <div className="editor-actions">
          {hasOverride && (
            <button className="editor-restore" onClick={onRestore}>
              Restore LRCLIB lyrics
            </button>
          )}
          <button className="editor-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="editor-save"
            disabled={!canSaveLines(lines)}
            onClick={() => onSave(lines)}
          >
            Save
          </button>
        </div>
      </div>
      <div className="editor-toolbar">
        <button
          className="editor-tool"
          disabled={selectedCount === 0}
          onClick={() => {
            setLines(deleteSelected(lines, selection));
            setSelection(EMPTY_SELECTION);
          }}
        >
          Delete selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </button>
        <button
          className={pasteOpen ? "editor-tool on" : "editor-tool"}
          aria-pressed={pasteOpen}
          onClick={() => setPasteOpen((open) => !open)}
        >
          Paste replace
        </button>
        <span className="editor-hint">
          Shift-click a checkbox to select a range. Timestamps are not
          editable.
        </span>
      </div>
      {pasteOpen && (
        <div className="editor-paste">
          <textarea
            className="editor-paste-input"
            aria-label="Replacement lyrics"
            placeholder="Paste plain text (one lyric per line) or LRC with [mm:ss.xx] timestamps"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="editor-paste-foot">
            <span className="editor-hint">
              {pasteKind === "lrc"
                ? "LRC detected: lines will be synced."
                : pasteKind === "plain"
                  ? "Plain text: lines will be unsynced."
                  : ""}
            </span>
            <button
              className="editor-tool"
              disabled={pasteKind === null}
              onClick={applyPaste}
            >
              Replace all lines
            </button>
          </div>
        </div>
      )}
      <div className="editor-lines" role="list">
        {lines.map((line, i) => (
          <div
            key={i}
            role="listitem"
            className={
              selection.indices.has(i) ? "editor-row selected" : "editor-row"
            }
          >
            <input
              type="checkbox"
              className="editor-check"
              aria-label={`Select line ${i + 1}`}
              checked={selection.indices.has(i)}
              readOnly
              onClick={(e) =>
                setSelection(toggleSelection(selection, i, e.shiftKey))
              }
            />
            {line.timeMs !== null && (
              <span className="editor-time">{formatTimestamp(line.timeMs)}</span>
            )}
            <input
              className="editor-text"
              aria-label={`Line ${i + 1} text`}
              lang="es"
              value={line.text}
              onChange={(e) => setLines(setLineText(lines, i, e.target.value))}
            />
          </div>
        ))}
        {lines.length === 0 && (
          <p className="editor-empty">
            No lines yet. Use paste replace to add the corrected lyrics.
          </p>
        )}
      </div>
    </div>
  );
}
