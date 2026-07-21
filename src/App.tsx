import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resetOverride, retranslate, saveOverride } from "./api";
import { isEnglishLyrics, lyricsPlainText, shouldTranslate } from "./detect";
import { fetchTranslationIfNeeded } from "./translation";
import { fetchLyrics } from "./lyrics";
import EmptyState from "./components/EmptyState";
import { lyricsEmptyState } from "./components/stateScreen";
import LyricsView from "./components/LyricsView";
import NowPlaying from "./components/NowPlaying";
import {
  AuthError,
  RateLimitError,
  beginLogin,
  fetchCurrentlyPlaying,
  handleCallback,
  isAuthenticated,
} from "./spotify";
import { PositionTracker, findActiveLine } from "./sync";
import type { LyricsResult, PlaybackState, TranslationEntry } from "./types";

type AuthState = "checking" | "loggedOut" | "loggedIn";
type LyricsState = { status: "idle" | "loading" | "error" } | {
  status: "ready";
  result: LyricsResult;
};
type TranslationState =
  | { status: "idle" | "loading" }
  | { status: "ready"; entry: TranslationEntry }
  | { status: "error"; message: string };

const POLL_MS = 3000;
const POLL_BACKOFF_MS = 10000;

export default function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsState>({ status: "idle" });
  const [translation, setTranslation] = useState<TranslationState>({
    status: "idle",
  });
  const [activeIndex, setActiveIndex] = useState(-1);
  const tracker = useRef(new PositionTracker());
  const trackIdRef = useRef<string | null>(null);

  // Handle the OAuth redirect, then decide the auth state.
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (window.location.pathname === "/callback" && code) {
      handleCallback(code, state).then((ok) => {
        window.history.replaceState({}, "", "/");
        setAuth(ok ? "loggedIn" : "loggedOut");
      });
      return;
    }
    setAuth(isAuthenticated() ? "loggedIn" : "loggedOut");
  }, []);

  // Poll Spotify for the currently playing track.
  useEffect(() => {
    if (auth !== "loggedIn") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      let delay = POLL_MS;
      try {
        const state = await fetchCurrentlyPlaying();
        if (cancelled) return;
        setRateLimited(false);
        if (state) {
          tracker.current.update(
            state.progressMs,
            state.isPlaying,
            performance.now()
          );
        } else {
          tracker.current.reset();
        }
        setPlayback(state);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof RateLimitError) {
          setRateLimited(true);
          delay = POLL_BACKOFF_MS;
        } else if (err instanceof AuthError) {
          setAuth("loggedOut");
          return;
        }
      }
      timer = setTimeout(poll, delay);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [auth]);

  const loadTranslation = useCallback(
    async (track: PlaybackState, result: LyricsResult) => {
      if (!shouldTranslate(result)) return;
      setTranslation({ status: "loading" });
      try {
        const entry = await fetchTranslationIfNeeded(track, result);
        if (trackIdRef.current !== track.trackId) return;
        if (!entry) {
          setTranslation({ status: "idle" });
          return;
        }
        setTranslation({ status: "ready", entry });
      } catch (err) {
        if (trackIdRef.current !== track.trackId) return;
        setTranslation({
          status: "error",
          message: err instanceof Error ? err.message : "Translation failed",
        });
      }
    },
    []
  );

  // Shared by the track-change effect and the error screen's Retry
  // button, so a failed LRCLIB fetch can be retried without waiting for
  // a track change.
  const loadLyrics = useCallback(
    (track: PlaybackState) => {
      setLyrics({ status: "loading" });
      fetchLyrics(track.title, track.artist, track.album, track.durationMs)
        .then((result) => {
          if (trackIdRef.current !== track.trackId) return;
          setLyrics({ status: "ready", result });
          loadTranslation(track, result);
        })
        .catch(() => {
          if (trackIdRef.current !== track.trackId) return;
          setLyrics({ status: "error" });
        });
    },
    [loadTranslation]
  );

  // Load lyrics and translation when the track changes.
  useEffect(() => {
    const trackId = playback?.trackId ?? null;
    if (trackId === trackIdRef.current) return;
    trackIdRef.current = trackId;
    setActiveIndex(-1);
    setTranslation({ status: "idle" });
    if (!playback || !trackId) {
      setLyrics({ status: "idle" });
      return;
    }
    loadLyrics(playback);
  }, [playback, loadLyrics]);

  // Recompute the active line every animation frame while synced
  // lyrics are showing.
  const syncedLines =
    lyrics.status === "ready" && lyrics.result.kind === "synced"
      ? lyrics.result.lines
      : null;

  // English lyrics render as a single pane and are never translated.
  const english = useMemo(
    () =>
      lyrics.status === "ready" &&
      (lyrics.result.kind === "synced" || lyrics.result.kind === "plain") &&
      isEnglishLyrics(lyricsPlainText(lyrics.result)),
    [lyrics]
  );
  useEffect(() => {
    if (!syncedLines) return;
    let raf: number;
    const tick = () => {
      const pos = tracker.current.positionAt(performance.now());
      setActiveIndex(findActiveLine(syncedLines, pos));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [syncedLines]);

  const withEntry = (promise: Promise<TranslationEntry>) =>
    promise
      .then((entry) => setTranslation({ status: "ready", entry }))
      .catch((err) =>
        setTranslation({
          status: "error",
          message: err instanceof Error ? err.message : "Server error",
        })
      );

  if (auth === "checking") return <div className="screen" />;

  if (auth === "loggedOut") {
    return (
      <div className="screen">
        <h1>Lyrics Translate</h1>
        <p>Synced Spanish lyrics with an English translation, side by side.</p>
        <button className="primary" onClick={() => beginLogin()}>
          Connect Spotify
        </button>
      </div>
    );
  }

  if (!playback) {
    return (
      <div className="screen">
        <EmptyState title="Nothing playing" message="Play something on Spotify." />
        {rateLimited && <span className="badge">rate limited, polling slower</span>}
      </div>
    );
  }

  const empty = lyricsEmptyState(lyrics);

  return (
    <div className="app">
      <NowPlaying
        playback={playback}
        lyrics={lyrics}
        translation={translation}
        rateLimited={rateLimited}
      />
      <main className="content">
        {empty && (
          <EmptyState
            artUrl={playback.albumArtUrl || undefined}
            title={playback.title}
            message={empty.message}
            action={
              empty.retryable ? (
                <button
                  className="retry-button"
                  onClick={() => loadLyrics(playback)}
                >
                  Retry
                </button>
              ) : undefined
            }
          />
        )}
        {lyrics.status === "ready" &&
          (lyrics.result.kind === "synced" || lyrics.result.kind === "plain") && (
            <LyricsView
              lyrics={lyrics.result}
              english={english}
              translation={translation}
              activeIndex={lyrics.result.kind === "synced" ? activeIndex : -1}
              onEdit={(i, field, text) =>
                withEntry(saveOverride(playback.trackId, i, field, text))
              }
              onResetLine={(i, field) =>
                withEntry(resetOverride(playback.trackId, i, field))
              }
              onRetranslate={() => {
                setTranslation({ status: "loading" });
                withEntry(retranslate(playback.trackId));
              }}
              onRetryTranslation={() =>
                lyrics.status === "ready" &&
                loadTranslation(playback, lyrics.result)
              }
            />
          )}
      </main>
    </div>
  );
}

export type { LyricsState, TranslationState };
