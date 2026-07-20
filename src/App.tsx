import { useCallback, useEffect, useRef, useState } from "react";
import {
  getTranslation,
  requestTranslation,
  resetOverride,
  retranslate,
  saveOverride,
} from "./api";
import { fetchLyrics } from "./lyrics";
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
      if (result.kind !== "synced" && result.kind !== "plain") return;
      setTranslation({ status: "loading" });
      const texts =
        result.kind === "synced"
          ? result.lines.map((l) => l.text)
          : result.lines;
      const times =
        result.kind === "synced"
          ? result.lines.map((l) => l.timeMs)
          : result.lines.map(() => 0);
      try {
        const cached = await getTranslation(track.trackId);
        if (trackIdRef.current !== track.trackId) return;
        if (cached) {
          setTranslation({ status: "ready", entry: cached });
          return;
        }
        const entry = await requestTranslation(
          track.trackId,
          track.title,
          track.artist,
          texts,
          times
        );
        if (trackIdRef.current !== track.trackId) return;
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
    setLyrics({ status: "loading" });
    const track = playback;
    fetchLyrics(track.title, track.artist, track.album, track.durationMs)
      .then((result) => {
        if (trackIdRef.current !== trackId) return;
        setLyrics({ status: "ready", result });
        loadTranslation(track, result);
      })
      .catch(() => {
        if (trackIdRef.current !== trackId) return;
        setLyrics({ status: "error" });
      });
  }, [playback, loadTranslation]);

  // Recompute the active line every animation frame while synced
  // lyrics are showing.
  const syncedLines =
    lyrics.status === "ready" && lyrics.result.kind === "synced"
      ? lyrics.result.lines
      : null;
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
        <h1>Nothing playing</h1>
        <p>Play something on Spotify.</p>
        {rateLimited && <span className="badge">rate limited, polling slower</span>}
      </div>
    );
  }

  return (
    <div className="app">
      <NowPlaying
        playback={playback}
        lyrics={lyrics}
        translation={translation}
        rateLimited={rateLimited}
      />
      <main className="content">
        {lyrics.status === "loading" && <div className="panel">Looking for lyrics...</div>}
        {lyrics.status === "error" && (
          <div className="panel">Could not reach the lyrics service.</div>
        )}
        {lyrics.status === "ready" && lyrics.result.kind === "none" && (
          <div className="panel">No lyrics found for this track.</div>
        )}
        {lyrics.status === "ready" && lyrics.result.kind === "instrumental" && (
          <div className="panel">Instrumental</div>
        )}
        {lyrics.status === "ready" &&
          (lyrics.result.kind === "synced" || lyrics.result.kind === "plain") && (
            <LyricsView
              lyrics={lyrics.result}
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
