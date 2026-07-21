import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteVocab,
  getLyricsOverride,
  listLyricsOverrides,
  listMarks,
  listVocab,
  markLyrics,
  reportMark,
  resetLyricsOverride,
  resetMark,
  resetOverride,
  retranslate,
  saveLyricsOverride,
  saveOverride,
  saveVocab,
  TrackMarkedError,
} from "./api";
import { isEnglishLyrics, lyricsPlainText, shouldTranslate } from "./detect";
import { fetchTranslationIfNeeded } from "./translation";
import { fetchLyrics } from "./lyrics";
import EmptyState from "./components/EmptyState";
import { lyricsEmptyState } from "./components/stateScreen";
import {
  canMarkWrong,
  MARKED_MESSAGE,
  markedFallbackRecord,
  markRequest,
  reportSpec,
  shouldLoadLyrics,
  toMarkMap,
  type ReportState,
} from "./components/markedLyrics";
import {
  lrclibSourceUrl,
  lyricsSourceFor,
  overrideSummary,
  overrideToLyricsResult,
  toOverrideMap,
  type LyricsSource,
} from "./components/lyricsOverride";
import {
  editorLinesFrom,
  overrideInput,
  type EditorLine,
} from "./components/lyricsEditing";
import LyricsEditor from "./components/LyricsEditor";
import LyricsView from "./components/LyricsView";
import NowPlaying from "./components/NowPlaying";
import SettingsPanel from "./components/SettingsPanel";
import VocabPanel from "./components/VocabPanel";
import {
  loadAppearance,
  saveAppearance,
  type AppearanceSettings,
} from "./components/settings";
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
  LyricsOverrideSummary,
  LyricsResult,
  MarkedTrack,
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
  // The track whose lyrics load was actually kicked off, distinct from
  // trackIdRef: a marked track (or one waiting on marksReady) is the
  // current track without ever loading.
  const loadedTrackRef = useRef<string | null>(null);
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

  // Wrong-lyrics marks: fetched once per app load, then kept in sync
  // from mark/reset responses, so a marked track costs zero network
  // beyond Spotify polling. Lyric loading waits for marksReady so a
  // marked track playing at boot never hits LRCLIB; if the marks fetch
  // fails the app proceeds as unmarked (availability over suppression).
  // The ref mirrors the state for the lyric-loading effect, which must
  // not re-run when marks change.
  const [marks, setMarks] = useState<Map<string, MarkedTrack>>(new Map());
  const [marksReady, setMarksReady] = useState(false);
  const marksRef = useRef(marks);
  marksRef.current = marks;
  const [reportState, setReportState] = useState<ReportState>("idle");

  // Lyric-source overrides: like marks, the summary list loads once per
  // session and gates lyric loading, so an overridden track never hits
  // LRCLIB. The ref mirrors the state for loadLyrics, which must not
  // re-create when overrides change.
  const [overrides, setOverrides] = useState<
    Map<string, LyricsOverrideSummary>
  >(new Map());
  const [overridesReady, setOverridesReady] = useState(false);
  const overridesRef = useRef(overrides);
  overridesRef.current = overrides;
  const [editorOpen, setEditorOpen] = useState(false);

  // Appearance settings: applied immediately, persisted best-effort.
  // The two slide-overs share the right edge, so opening one closes the
  // other.
  const [appearance, setAppearance] = useState(() => loadAppearance());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const updateAppearance = useCallback((next: AppearanceSettings) => {
    setAppearance(next);
    saveAppearance(next);
  }, []);

  useEffect(() => {
    if (auth !== "loggedIn") return;
    let cancelled = false;
    listVocab()
      .then((entries) => {
        if (!cancelled) setVocab(entries);
      })
      .catch(() => {});
    listMarks()
      .then((records) => {
        if (!cancelled) setMarks(toMarkMap(records));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMarksReady(true);
      });
    listLyricsOverrides()
      .then((records) => {
        if (!cancelled) setOverrides(toOverrideMap(records));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setOverridesReady(true);
      });
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
        if (err instanceof TrackMarkedError) {
          // The server says this track is marked and the client's map
          // was stale: suppress the lyrics instead of showing an error.
          // A local fallback record flips the screen immediately; the
          // real record (with lrclibId) refreshes best-effort.
          setTranslation({ status: "idle" });
          setMarks((prev) =>
            prev.has(track.trackId)
              ? prev
              : new Map(prev).set(track.trackId, markedFallbackRecord(track))
          );
          listMarks()
            .then((records) => setMarks(toMarkMap(records)))
            .catch(() => {});
          return;
        }
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
  // a track change. The pure lyricsSourceFor routing keeps LRCLIB out
  // of the picture entirely while an override exists; restore forces
  // the lrclib source because the overrides state has not re-rendered
  // into the ref yet. A listed override missing its record (deleted on
  // disk) falls back to LRCLIB: availability over suppression.
  const loadLyrics = useCallback(
    (track: PlaybackState, source?: LyricsSource) => {
      loadedTrackRef.current = track.trackId;
      setLyrics({ status: "loading" });
      const fromLrclib = () =>
        fetchLyrics(track.title, track.artist, track.album, track.durationMs);
      const route =
        source ?? lyricsSourceFor(track.trackId, overridesRef.current);
      const fetching =
        route === "override"
          ? getLyricsOverride(track.trackId).then((record) =>
              record ? overrideToLyricsResult(record) : fromLrclib()
            )
          : fromLrclib();
      fetching
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

  // Reset per-track state when the track changes, then load lyrics once
  // shouldLoadLyrics allows it: never before the marks list resolves,
  // never for a marked track, never twice for the same track
  // (loadedTrackRef, stamped inside loadLyrics, absorbs both the 3s
  // poll re-renders and the marksReady flip).
  useEffect(() => {
    const trackId = playback?.trackId ?? null;
    if (trackId !== trackIdRef.current) {
      trackIdRef.current = trackId;
      loadedTrackRef.current = null;
      setActiveIndex(-1);
      setLyrics({ status: "idle" });
      setTranslation({ status: "idle" });
      setReportState("idle");
      setEditorOpen(false);
      clearTimeout(noticeTimer.current);
      setNotice(null);
    }
    if (
      playback &&
      shouldLoadLyrics(
        trackId,
        marksReady && overridesReady,
        marksRef.current,
        loadedTrackRef.current
      )
    ) {
      loadLyrics(playback);
    }
  }, [playback, marksReady, overridesReady, loadLyrics]);

  // Covers the two paths the track-change effect cannot: the current
  // track just got marked, and the marks list arriving after the first
  // track already started loading. Either way the lyrics are dropped so
  // no marked content renders.
  useEffect(() => {
    if (!playback || !marks.has(playback.trackId)) return;
    if (lyrics.status !== "idle") setLyrics({ status: "idle" });
    setTranslation((t) => (t.status === "idle" ? t : { status: "idle" }));
  }, [marks, playback, lyrics]);

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
    if (editorOpen) return;
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
  }, [syncedLines, activeIndex, replayLine, editorOpen]);

  // Mark the current track's lyrics wrong: the server records it and
  // deletes the cached translation, the marks map flips the lyrics area
  // to the marked screen.
  const markWrong = useCallback(async () => {
    if (!playback || lyrics.status !== "ready") return;
    try {
      const record = await markLyrics(markRequest(playback, lyrics.result));
      setMarks((prev) => new Map(prev).set(record.trackId, record));
    } catch {
      showNotice("Could not mark the lyrics");
    }
  }, [playback, lyrics, showNotice]);

  // Reset re-enters the normal flow: the cache was deleted at mark
  // time, so this re-fetches from LRCLIB and re-translates once.
  const resetWrongMark = useCallback(async () => {
    if (!playback) return;
    try {
      await resetMark(playback.trackId);
      setMarks((prev) => {
        const next = new Map(prev);
        next.delete(playback.trackId);
        return next;
      });
      setReportState("idle");
      loadLyrics(playback);
    } catch {
      showNotice("Could not reset the mark");
    }
  }, [playback, loadLyrics, showNotice]);

  // One-shot community flag; the server does the LRCLIB challenge and
  // proof of work. Success or failure surfaces as a brief notice.
  const reportWrongLyrics = useCallback(async () => {
    if (!playback) return;
    setReportState("pending");
    try {
      await reportMark(playback.trackId);
      setReportState("sent");
      showNotice("Reported to LRCLIB");
    } catch {
      setReportState("idle");
      showNotice("Could not report to LRCLIB");
    }
  }, [playback, showNotice]);

  // Save the edited lyrics as the track's source override. The server
  // stores it, deletes the cached translation, and clears a
  // wrong-lyrics mark (fixing supersedes suppressing); the client then
  // shows the override and triggers exactly one fresh translation of
  // the surviving lines.
  const saveLyricsEdit = useCallback(
    async (lines: EditorLine[], lrclibId: number | undefined) => {
      if (!playback) return;
      try {
        const record = await saveLyricsOverride(
          overrideInput(playback, lines, lrclibId)
        );
        setOverrides((prev) =>
          new Map(prev).set(record.trackId, overrideSummary(record))
        );
        setMarks((prev) => {
          if (!prev.has(record.trackId)) return prev;
          const next = new Map(prev);
          next.delete(record.trackId);
          return next;
        });
        setReportState("idle");
        setEditorOpen(false);
        const result = overrideToLyricsResult(record);
        loadedTrackRef.current = record.trackId;
        setLyrics({ status: "ready", result });
        loadTranslation(playback, result);
      } catch {
        showNotice("Could not save the lyrics");
      }
    },
    [playback, loadTranslation, showNotice]
  );

  // Restore removes the override and re-enters the normal LRCLIB
  // fetch-and-translate flow (the server deleted the stale translation
  // cache). The lrclib source is forced because the overrides state has
  // not re-rendered into loadLyrics's ref yet.
  const restoreLyrics = useCallback(async () => {
    if (!playback) return;
    try {
      await resetLyricsOverride(playback.trackId);
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(playback.trackId);
        return next;
      });
      setEditorOpen(false);
      loadLyrics(playback, "lrclib");
    } catch {
      showNotice("Could not restore the lyrics");
    }
  }, [playback, loadLyrics, showNotice]);

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
  const markedRecord = marks.get(playback.trackId);
  const report = markedRecord ? reportSpec(markedRecord, reportState) : null;

  // Best-known LRCLIB id for the source link and the override record:
  // the loaded lyrics first, then the stored override, then the mark.
  const lyricResult =
    lyrics.status === "ready" &&
    (lyrics.result.kind === "synced" || lyrics.result.kind === "plain")
      ? lyrics.result
      : null;
  const knownLrclibId =
    lyricResult?.lrclibId ??
    overrides.get(playback.trackId)?.lrclibId ??
    markedRecord?.lrclibId;
  const sourceUrl = lrclibSourceUrl(
    knownLrclibId,
    playback.title,
    playback.artist
  );

  const openEditor = () => {
    setVocabOpen(false);
    setSettingsOpen(false);
    setEditorOpen(true);
  };

  return (
    <div className="app">
      <NowPlaying
        playback={playback}
        lyrics={lyrics}
        translation={translation}
        canMarkWrong={!markedRecord && canMarkWrong(lyrics)}
        onMarkWrong={markWrong}
        canEditLyrics={!editorOpen && !markedRecord && canMarkWrong(lyrics)}
        onEditLyrics={openEditor}
        sourceUrl={lyricResult || markedRecord ? sourceUrl : null}
        rateLimited={rateLimited}
        vocabOpen={vocabOpen}
        onToggleVocab={() => {
          setSettingsOpen(false);
          setVocabOpen((open) => !open);
        }}
        settingsOpen={settingsOpen}
        onToggleSettings={() => {
          setVocabOpen(false);
          setSettingsOpen((open) => !open);
        }}
      />
      <main className="content">
        {editorOpen && (
          <LyricsEditor
            key={playback.trackId}
            title={playback.title}
            artist={playback.artist}
            initialLines={lyricResult ? editorLinesFrom(lyricResult) : []}
            sourceUrl={sourceUrl}
            hasOverride={overrides.has(playback.trackId)}
            onSave={(lines) => saveLyricsEdit(lines, knownLrclibId)}
            onRestore={restoreLyrics}
            onCancel={() => setEditorOpen(false)}
          />
        )}
        {!editorOpen && markedRecord && report && (
          <EmptyState
            artUrl={playback.albumArtUrl || undefined}
            title={playback.title}
            message={MARKED_MESSAGE}
            action={
              <div className="empty-actions">
                <button className="retry-button" onClick={resetWrongMark}>
                  Reset
                </button>
                <button
                  className="report-button"
                  disabled={!report.enabled}
                  title={report.title}
                  onClick={reportWrongLyrics}
                >
                  {report.label}
                </button>
                <button
                  className="report-button"
                  title="Paste corrected lyrics for this track instead of suppressing it"
                  onClick={openEditor}
                >
                  Edit lyrics
                </button>
              </div>
            }
          />
        )}
        {!editorOpen && !markedRecord && empty && (
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
        {!editorOpen &&
          !markedRecord &&
          lyrics.status === "ready" &&
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
              appearance={appearance}
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
      {settingsOpen && (
        <SettingsPanel
          settings={appearance}
          onChange={updateAppearance}
          onClose={() => setSettingsOpen(false)}
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
