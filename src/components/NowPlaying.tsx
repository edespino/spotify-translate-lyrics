import type { LyricsState, TranslationState } from "../App";
import type { PlaybackState } from "../types";

interface Props {
  playback: PlaybackState;
  lyrics: LyricsState;
  translation: TranslationState;
  rateLimited: boolean;
}

function lyricsLabel(lyrics: LyricsState): string {
  if (lyrics.status === "loading") return "finding lyrics";
  if (lyrics.status === "error") return "lyrics unavailable";
  if (lyrics.status !== "ready") return "";
  switch (lyrics.result.kind) {
    case "synced":
      return "synced";
    case "plain":
      return "unsynced";
    case "instrumental":
      return "instrumental";
    case "none":
      return "no lyrics";
  }
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
  rateLimited,
}: Props) {
  return (
    <header className="now-playing">
      {playback.albumArtUrl && (
        <img className="album-art" src={playback.albumArtUrl} alt="" />
      )}
      <div className="track-info">
        <div className="track-title">{playback.title}</div>
        <div className="track-artist">{playback.artist}</div>
      </div>
      <div className="status">
        {!playback.isPlaying && <span className="badge">paused</span>}
        {lyricsLabel(lyrics) && (
          <span className="badge">{lyricsLabel(lyrics)}</span>
        )}
        {translationLabel(translation) && (
          <span className="badge">{translationLabel(translation)}</span>
        )}
        {rateLimited && <span className="badge warn">rate limited</span>}
      </div>
    </header>
  );
}
