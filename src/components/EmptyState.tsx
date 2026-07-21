import type { ReactNode } from "react";

interface Props {
  artUrl?: string;
  title: string;
  message: string;
  action?: ReactNode;
}

// Shared layout for every non-lyric state (loading, none, instrumental,
// lyrics-service error, nothing playing): large album art, track title,
// then the status line, vertically centered in the lyrics area. A
// missing artwork URL renders a dim music-note block, never a broken
// image.
export default function EmptyState({ artUrl, title, message, action }: Props) {
  return (
    <div className="empty-state">
      {artUrl ? (
        <img className="empty-art" src={artUrl} alt="" />
      ) : (
        <div className="empty-art placeholder" aria-hidden="true">
          ♪
        </div>
      )}
      <div className="empty-title">{title}</div>
      <p className="empty-message">{message}</p>
      {action}
    </div>
  );
}
