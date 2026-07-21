import type { LyricsState, TranslationState } from "../App";
import { syncBadge } from "./syncStatus";
import { translatedTitle } from "../translation";
import type { PlaybackState } from "../types";

interface Props {
  playback: PlaybackState;
  lyrics: LyricsState;
  translation: TranslationState;
  canMarkWrong: boolean;
  onMarkWrong: () => void;
  canEditLyrics: boolean;
  onEditLyrics: () => void;
  sourceUrl: string | null;
  rateLimited: boolean;
  vocabOpen: boolean;
  onToggleVocab: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

function translationLabel(translation: TranslationState): string {
  switch (translation.status) {
    case "loading":
      return "translating";
    case "ready":
      return "translated";
    case "error":
      return "translation failed";
    default:
      return "";
  }
}

export default function NowPlaying({
  playback,
  lyrics,
  translation,
  canMarkWrong,
  onMarkWrong,
  canEditLyrics,
  onEditLyrics,
  sourceUrl,
  rateLimited,
  vocabOpen,
  onToggleVocab,
  settingsOpen,
  onToggleSettings,
}: Props) {
  // English songs never reach "ready" (translation stays idle), so the
  // secondary title only appears for translated tracks.
  const titleEn =
    translation.status === "ready"
      ? translatedTitle(playback.title, translation.entry.titleEn)
      : null;
  const sync = syncBadge(lyrics);
  return (
    <header className="now-playing">
      {playback.albumArtUrl && (
        <img className="album-art" src={playback.albumArtUrl} alt="" />
      )}
      <div className="track-info">
        <div className="track-title">
          {playback.title}
          {titleEn && <span className="track-title-en">({titleEn})</span>}
        </div>
        <div className="track-artist">{playback.artist}</div>
      </div>
      <div className="status">
        {!playback.isPlaying && <span className="badge">paused</span>}
        {sync && (
          <span className="badge" title={sync.title}>
            {sync.label}
          </span>
        )}
        {sourceUrl && (
          <a
            className="source-link"
            href={sourceUrl}
            target="_blank"
            rel="noopener"
            title="View the LRCLIB record these lyrics came from"
          >
            LRCLIB
          </a>
        )}
        {translationLabel(translation) && (
          <span className="badge">{translationLabel(translation)}</span>
        )}
        {rateLimited && <span className="badge warn">rate limited</span>}
        {canEditLyrics && (
          <button
            className="edit-lyrics-toggle"
            title="Correct these lyrics: delete or edit lines, or paste a replacement"
            data-edit-lyrics
            onClick={onEditLyrics}
          >
            Edit lyrics
          </button>
        )}
        {canMarkWrong && (
          <button
            className="mark-wrong-toggle"
            title="These lyrics are wrong: hide them for this track"
            data-mark-wrong
            onClick={onMarkWrong}
          >
            Mark wrong
          </button>
        )}
        <button
          className={vocabOpen ? "vocab-toggle on" : "vocab-toggle"}
          aria-pressed={vocabOpen}
          title="Saved vocabulary"
          data-vocab-toggle
          onClick={onToggleVocab}
        >
          Vocab
        </button>
        <button
          className={settingsOpen ? "settings-toggle on" : "settings-toggle"}
          aria-pressed={settingsOpen}
          title="Appearance settings"
          data-settings-toggle
          onClick={onToggleSettings}
        >
          Settings
        </button>
      </div>
    </header>
  );
}
