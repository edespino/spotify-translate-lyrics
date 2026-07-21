import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteVocab,
  listVocab,
  resetOverride,
  retranslate,
  saveOverride,
  saveVocab,
} from "./api";
import { isEnglishLyrics, lyricsPlainText, shouldTranslate } from "./detect";
import { fetchTranslationIfNeeded } from "./translation";
import { fetchLyrics } from "./lyrics";
import EmptyState from "./components/EmptyState";
import { lyricsEmptyState } from "./components/stateScreen";
import LyricsView from "./components/LyricsView";
import NowPlaying from "./components/NowPlaying";
import VocabPanel from "./components/VocabPanel";
import { isTypingTarget } from "./components/lyricsRow";
import {
  insertBySavedAt,
  savedKeySet,
  upsertEntry,
  vocabKey,
} from "./components/vocab";
import type { GlossEntry } from "./gloss";
import {
  AuthError,
  RateLimitError,
  SeekUnavailableError,
  beginLogin,
  fetchCurrentlyPlaying,
  handleCallback,
  isAuthenticated,
  seekTo,
} from "./spotify";
import { PositionTracker, findActiveLine } from "./sync";
import type {
  LyricsResult,
  PlaybackState,
  TranslationEntry,
  VocabEntry,
} from "./types";

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
  const [notice, setNotice] = useState<string | null>(null);
  const tracker = useRef(new PositionTracker());
  const trackIdRef = useRef<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  // Set by the poll effect; lets the seek path trigger an immediate
  // currently-playing poll to reconcile after a replay.
  const requestPoll = useRef<() => void>(() => {});

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  const showNotice = useCallback((message: string) => {
    clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  // Saved vocabulary: fetched once per app load, then kept in sync
  // optimistically on save and delete with rollback on failure.
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [vocabOpen, setVocabOpen] = useState(false);

  useEffect(() => {
    if (auth !== "loggedIn") return;
    let cancelled = false;
    listVocab()
      .then((entries) => {
        if (!cancelled) setVocab(entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [auth]);

  const savedGlossKeys = useMemo(() => savedKeySet(vocab), [vocab]);

  const saveGlossToVocab = useCallback(
    (entry: GlossEntry, contextLine: string) => {
      if (!playback) return;
      const key = vocabKey(entry.word, contextLine);
      if (savedGlossKeys.has(key)) return;
      const input = {
        word: entry.word,
        gloss: entry.gloss,
        partOfSpeech: entry.partOfSpeech,
        note: entry.note,
        contextLine,
        trackId: playback.trackId,
        trackTitle: playback.title,
        artist: playback.artist,
      };
      // Optimistic: show the entry immediately under a provisional id;
      // the server response swaps in the real id and savedAt, a failure
      // rolls the entry back out.
      const provisional: VocabEntry = {
        id: `pending:${key}`,
        ...input,
        savedAt: new Date().toISOString(),
      };
      setVocab((v) => upsertEntry(v, provisional));
      saveVocab(input)
        .then(({ entry: saved }) => setVocab((v) => upsertEntry(v, saved)))
        .catch(() => {
          setVocab((v) => v.filter((e) => e.id !== provisional.id));
          showNotice("Could not save word");
        });
    },
    [playback, savedGlossKeys, showNotice]
  );

  const removeVocabEntry = useCallback(
    (id: string) => {
      const entry = vocab.find((e) => e.id === id);
      if (!entry) return;
      setVocab((v) => v.filter((e) => e.id !== id));
      deleteVocab(id).catch(() => {
        setVocab((v) =>
          v.some((e) => e.id === id) ? v : insertBySavedAt(v, entry)
        );
        showNotice("Could not delete word");
      });
    },
    [vocab, showNotice]
  );

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
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      inFlight = true;
      let delay = POLL_MS;
      try {
        const state = await fetchCurrentlyPlaying();
        inFlight = false;
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
        inFlight = false;
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
    requestPoll.current = () => {
      if (cancelled || inFlight) return;
      clearTimeout(timer);
      poll();
    };
    poll();
    return () => {
      cancelled = true;
      requestPoll.current = () => {};
      clearTimeout(timer);
    };
  }, [auth]);

  // Seek Spotify to a line's start, snap the local tracker there, then
  // poll right away to reconcile. Seek failures (no active device, a
  // restricted context) surface as a brief notice, never a crash.
  const replayLine = useCallback(
    async (timeMs: number) => {
      try {
        await seekTo(timeMs);
        tracker.current.nudge(timeMs, performance.now());
        requestPoll.current();
      } catch (err) {
        if (err instanceof AuthError) {
          setAuth("loggedOut");
          return;
        }
        showNotice(
          err instanceof SeekUnavailableError
            ? "Replay needs an active Spotify device"
            : "Replay failed"
        );
      }
    },
    [showNotice]
  );

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
    clearTimeout(noticeTimer.current);
    setNotice(null);
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

  // Global "r": replay the current active line. Rows handle their own
  // "r" (and stop propagation); typing targets are guarded so the edit
  // input never triggers a seek.
  useEffect(() => {
    if (!syncedLines) return;
    const lines = syncedLines;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "r" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (isTypingTarget(target?.tagName, target?.isContentEditable ?? false))
        return;
      if (activeIndex < 0) return;
      const line = lines[activeIndex];
      if (!line || line.text.trim() === "") return;
      e.preventDefault();
      replayLine(line.timeMs);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [syncedLines, activeIndex, replayLine]);

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
        vocabOpen={vocabOpen}
        onToggleVocab={() => setVocabOpen((open) => !open)}
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
              trackId={playback.trackId}
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
              onReplay={replayLine}
              savedGlossKeys={savedGlossKeys}
              onSaveGloss={saveGlossToVocab}
            />
          )}
      </main>
      {vocabOpen && (
        <VocabPanel
          entries={vocab}
          onDelete={removeVocabEntry}
          onClose={() => setVocabOpen(false)}
        />
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

export type { LyricsState, TranslationState };
