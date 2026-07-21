import express from "express";
import {
  GlossCache,
  glossCacheKey,
  LyricsOverrideStore,
  MarkStore,
  normalizeGlossText,
  TranslationCache,
  VocabStore,
} from "./cache";
import { reportWrongLyrics, type SolveBudget } from "./lrclibFlag";
import {
  TranslationFailedError,
  glossWord,
  translateLinesWithTitle,
  translateTitle,
} from "./translator";
import type {
  GlossEntry,
  LyricsOverrideLine,
  TranslationEntry,
  TranslationProvider,
  VocabInput,
} from "./types";

const TITLE_BACKFILL_RESPONSE_TIMEOUT_MS = 1500;

interface AppHooks {
  onGlossInFlightHit?: (key: string) => void;
}

interface AppOptions {
  // Overridden by tests so the LRCLIB flag flow talks to a local mock;
  // the real service is never called from tests.
  lrclibBaseUrl?: string;
  flagSolveBudget?: SolveBudget;
}

export function createApp(
  provider: TranslationProvider,
  dataDir: string,
  hooks: AppHooks = {},
  options: AppOptions = {}
) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const cache = new TranslationCache(dataDir);
  const glossCache = new GlossCache(dataDir);
  const vocabStore = new VocabStore(dataDir);
  const markStore = new MarkStore(dataDir);
  const overrideStore = new LyricsOverrideStore(dataDir);
  const lrclibBaseUrl = options.lrclibBaseUrl ?? "https://lrclib.net";

  // In-flight requests per track so a double-submit does not call the
  // provider twice.
  const inFlight = new Map<string, Promise<TranslationEntry>>();
  const titleInFlight = new Map<string, Promise<TranslationEntry | null>>();
  const glossInFlight = new Map<string, Promise<GlossEntry>>();

  function hasTranslatedLyrics(entry: TranslationEntry): boolean {
    return entry.lines.some((line) =>
      Object.prototype.hasOwnProperty.call(line, "en")
    );
  }

  async function backfillTitleEn(
    entry: TranslationEntry
  ): Promise<TranslationEntry> {
    if (
      entry.titleEn !== undefined ||
      entry.title.trim() === "" ||
      !hasTranslatedLyrics(entry)
    ) {
      return entry;
    }

    let pending = titleInFlight.get(entry.trackId);
    if (!pending) {
      pending = (async () => {
        const titleEn = await translateTitle(provider, {
          trackId: entry.trackId,
          title: entry.title,
          artist: entry.artist,
        });
        return cache.setTitleEn(entry.trackId, titleEn);
      })();
      titleInFlight.set(entry.trackId, pending);
      pending.finally(() => titleInFlight.delete(entry.trackId)).catch(() => {});
    }

    try {
      return (await pending) ?? entry;
    } catch {
      return entry;
    }
  }

  async function backfillTitleEnForResponse(
    entry: TranslationEntry
  ): Promise<TranslationEntry> {
    return Promise.race([
      backfillTitleEn(entry),
      new Promise<TranslationEntry>((resolve) => {
        setTimeout(() => resolve(entry), TITLE_BACKFILL_RESPONSE_TIMEOUT_MS);
      }),
    ]);
  }

  function containsGlossWord(word: string, context: string): boolean {
    const normalizedWord = normalizeGlossText(word);
    if (normalizedWord === "") return false;
    const normalizedContext = normalizeGlossText(context);
    const escaped = normalizedWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,
      "u"
    ).test(normalizedContext);
  }

  app.get("/api/translations/:trackId", async (req, res) => {
    try {
      const entry = await cache.read(req.params.trackId);
      if (!entry) return res.status(404).json({ error: "Not cached" });
      res.json(await backfillTitleEnForResponse(entry));
    } catch {
      res.status(400).json({ error: "Bad track id" });
    }
  });

  app.post("/api/translate", async (req, res) => {
    const { trackId, title, artist, lines, timesMs, lrclibId } =
      req.body ?? {};
    if (
      typeof trackId !== "string" ||
      !Array.isArray(lines) ||
      lines.some((l: unknown) => typeof l !== "string")
    ) {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      // Marked tracks never translate; the client does not call this
      // while a mark exists, the 409 is a guard.
      if (await markStore.get(trackId)) {
        return res.status(409).json({ error: "Lyrics marked wrong" });
      }
      const cached = await cache.read(trackId);
      if (cached) return res.json(await backfillTitleEnForResponse(cached));

      // A lyric-source override replaces the request body as the source
      // of truth: the client sends the same lines, but substituting here
      // guarantees a stale or hostile body can never get the LRCLIB
      // text translated and cached while an override exists.
      const override = await overrideStore.read(trackId);
      const srcLines: string[] = override
        ? override.lines.map((l) => l.text)
        : lines;
      const srcTimes: number[] = override
        ? override.lines.map((l) => l.timeMs)
        : Array.isArray(timesMs)
          ? lines.map((_: string, i: number) => Number(timesMs[i]) || 0)
          : lines.map(() => 0);
      const srcLrclibId = override?.lrclibId ?? lrclibId;

      let pending = inFlight.get(trackId);
      if (!pending) {
        pending = (async () => {
          const { titleEn, en } = await translateLinesWithTitle(
            provider,
            srcLines,
            {
              trackId,
              title: String(title ?? ""),
              artist: String(artist ?? ""),
            }
          );
          const entry: TranslationEntry = {
            trackId,
            title: String(title ?? ""),
            artist: String(artist ?? ""),
            titleEn,
            ...(typeof srcLrclibId === "number"
              ? { lrclibId: srcLrclibId }
              : {}),
            lines: srcLines.map((es: string, i: number) => ({
              timeMs: srcTimes[i] ?? 0,
              es,
              en: en[i] ?? "",
            })),
          };
          // Re-check the mark and the override at write time: a mark
          // made while the provider was running deletes the cache, and
          // this write must not resurrect it; likewise an override saved
          // (or removed) mid-translation makes this result stale. The
          // client still gets the translation; it just is not persisted.
          // /api/mark and /api/lyrics-override both record before
          // queueing their cache delete, so a write ordered after the
          // delete always sees the change.
          await cache.writeUnless(entry, async () => {
            if (await markStore.get(trackId)) return true;
            const current = await overrideStore.read(trackId);
            return (current?.savedAt ?? null) !== (override?.savedAt ?? null);
          });
          return entry;
        })();
        inFlight.set(trackId, pending);
        // The .finally() chain is its own promise; swallow its
        // rejection so a failed translation is only reported through
        // the awaited `pending` below.
        pending.finally(() => inFlight.delete(trackId)).catch(() => {});
      }
      res.json(await pending);
    } catch (err: any) {
      const status = err instanceof TranslationFailedError ? 502 : 500;
      res.status(status).json({ error: err?.message || "Translation failed" });
    }
  });

  app.post("/api/gloss", async (req, res) => {
    const { word, context } = req.body ?? {};
    if (
      typeof word !== "string" ||
      typeof context !== "string" ||
      word.trim() === "" ||
      context.trim() === "" ||
      word.length > 64 ||
      context.length > 500 ||
      !containsGlossWord(word, context)
    ) {
      return res.status(400).json({ error: "Bad gloss request" });
    }

    const sourceWord = word.trim();
    const sourceContext = context.trim();
    const key = glossCacheKey(sourceWord, sourceContext);

    try {
      const cached = await glossCache.read(key);
      if (cached) return res.json(cached);

      let pending = glossInFlight.get(key);
      if (!pending) {
        pending = (async () => {
          const entry = await glossWord(provider, sourceWord, sourceContext);
          await glossCache.write(key, entry);
          return entry;
        })();
        glossInFlight.set(key, pending);
        pending.finally(() => glossInFlight.delete(key)).catch(() => {});
      } else {
        hooks.onGlossInFlightHit?.(key);
      }
      res.json(await pending);
    } catch (err: any) {
      const status = err instanceof TranslationFailedError ? 502 : 500;
      res.status(status).json({
        error: status === 502 ? "gloss provider failed" : "Gloss failed",
      });
    }
  });

  // Vocabulary capture. Length caps mirror the gloss endpoint's spirit:
  // a word and its lyric-line context are small; anything oversized is a
  // bad request, not data.
  const VOCAB_FIELDS: Array<{
    name: keyof VocabInput;
    max: number;
    required: boolean;
  }> = [
    { name: "word", max: 64, required: true },
    { name: "gloss", max: 500, required: true },
    { name: "contextLine", max: 500, required: true },
    { name: "partOfSpeech", max: 64, required: false },
    { name: "note", max: 500, required: false },
    { name: "trackId", max: 128, required: false },
    { name: "trackTitle", max: 300, required: false },
    { name: "artist", max: 300, required: false },
  ];

  function parseVocabInput(body: unknown): VocabInput | null {
    const raw = (body ?? {}) as Record<string, unknown>;
    const input = {} as VocabInput;
    for (const field of VOCAB_FIELDS) {
      const value = raw[field.name] ?? "";
      if (typeof value !== "string" || value.length > field.max) return null;
      const trimmed = value.trim();
      if (field.required && trimmed === "") return null;
      input[field.name] = trimmed;
    }
    return input;
  }

  app.get("/api/vocab", async (_req, res) => {
    try {
      res.json(await vocabStore.list());
    } catch {
      res.status(500).json({ error: "Vocab read failed" });
    }
  });

  app.post("/api/vocab", async (req, res) => {
    const input = parseVocabInput(req.body);
    if (!input) return res.status(400).json({ error: "Bad vocab request" });
    try {
      const { entry, duplicate } = await vocabStore.add(input);
      res.json({ duplicate, entry });
    } catch {
      res.status(500).json({ error: "Vocab write failed" });
    }
  });

  app.delete("/api/vocab/:id", async (req, res) => {
    const { id } = req.params;
    if (!/^[0-9a-f]{40}$/.test(id)) {
      return res.status(400).json({ error: "Bad vocab id" });
    }
    try {
      if (!(await vocabStore.remove(id))) {
        return res.status(404).json({ error: "Not found" });
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Vocab write failed" });
    }
  });

  // Wrong-lyrics marks. Marking deletes the cached translation right
  // away (delete-on-mark), so reset simply re-enters the normal
  // fetch-and-translate flow with nothing stale to invalidate. The
  // lrclibId is taken from the request, falling back to the cache entry
  // being deleted, so the mark record can still flag the LRCLIB entry.
  app.get("/api/marks", async (_req, res) => {
    try {
      res.json(await markStore.list());
    } catch {
      res.status(500).json({ error: "Marks read failed" });
    }
  });

  app.post("/api/mark", async (req, res) => {
    const { trackId, title, artist, lrclibId } = req.body ?? {};
    if (typeof trackId !== "string") {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      const cached = await cache.read(trackId);
      const id =
        typeof lrclibId === "number" ? lrclibId : cached?.lrclibId;
      const record = await markStore.mark({
        trackId,
        title: String(title ?? cached?.title ?? ""),
        artist: String(artist ?? cached?.artist ?? ""),
        ...(typeof id === "number" ? { lrclibId: id } : {}),
      });
      await cache.remove(trackId);
      res.json(record);
    } catch {
      res.status(400).json({ error: "Bad track id" });
    }
  });

  app.post("/api/mark/reset", async (req, res) => {
    const { trackId } = req.body ?? {};
    if (typeof trackId !== "string") {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      if (!(await markStore.reset(trackId))) {
        return res.status(404).json({ error: "Not marked" });
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Marks write failed" });
    }
  });

  // One-shot community flag to LRCLIB: challenge, bounded proof of
  // work, flag POST. Never retried here; a failure answers 502 once.
  app.post("/api/mark/report", async (req, res) => {
    const { trackId } = req.body ?? {};
    if (typeof trackId !== "string") {
      return res.status(400).json({ error: "Bad request" });
    }
    let record;
    try {
      record = await markStore.get(trackId);
    } catch {
      return res.status(500).json({ error: "Marks read failed" });
    }
    if (!record) return res.status(404).json({ error: "Not marked" });
    if (typeof record.lrclibId !== "number") {
      return res
        .status(409)
        .json({ error: "No LRCLIB id recorded for this track" });
    }
    try {
      await reportWrongLyrics(
        lrclibBaseUrl,
        record.lrclibId,
        options.flagSolveBudget
      );
      res.json({ ok: true });
    } catch {
      res.status(502).json({ error: "LRCLIB report failed" });
    }
  });

  // Lyric-source overrides. Saving replaces LRCLIB as the track's lyric
  // source, deletes the cached translation (so the next translate call
  // is exactly one fresh provider run over the corrected lines), and
  // clears a wrong-lyrics mark if one exists: fixing supersedes
  // suppressing. Restore removes the override and deletes the cache so
  // the normal LRCLIB fetch-and-translate flow re-enters cleanly.
  const OVERRIDE_MAX_LINES = 2000;
  const OVERRIDE_MAX_LINE_LENGTH = 500;

  function parseOverrideLines(raw: unknown): LyricsOverrideLine[] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    if (raw.length > OVERRIDE_MAX_LINES) return null;
    const lines: LyricsOverrideLine[] = [];
    for (const item of raw) {
      const { timeMs, text } = (item ?? {}) as Record<string, unknown>;
      if (typeof text !== "string" || text.length > OVERRIDE_MAX_LINE_LENGTH) {
        return null;
      }
      if (typeof timeMs !== "number" || !Number.isFinite(timeMs) || timeMs < 0) {
        return null;
      }
      lines.push({ timeMs, text });
    }
    return lines;
  }

  app.get("/api/lyrics-overrides", async (_req, res) => {
    try {
      res.json(await overrideStore.list());
    } catch {
      res.status(500).json({ error: "Overrides read failed" });
    }
  });

  app.get("/api/lyrics-overrides/:trackId", async (req, res) => {
    try {
      const record = await overrideStore.read(req.params.trackId);
      if (!record) return res.status(404).json({ error: "Not overridden" });
      res.json(record);
    } catch {
      res.status(400).json({ error: "Bad track id" });
    }
  });

  app.post("/api/lyrics-override", async (req, res) => {
    const { trackId, title, artist, kind, lines, lrclibId } = req.body ?? {};
    const parsedLines = parseOverrideLines(lines);
    if (
      typeof trackId !== "string" ||
      (kind !== "synced" && kind !== "plain") ||
      !parsedLines
    ) {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      const cached = await cache.read(trackId);
      const id =
        typeof lrclibId === "number" ? lrclibId : cached?.lrclibId;
      const record = await overrideStore.save({
        trackId,
        title: String(title ?? cached?.title ?? ""),
        artist: String(artist ?? cached?.artist ?? ""),
        kind,
        lines: parsedLines,
        ...(typeof id === "number" ? { lrclibId: id } : {}),
      });
      await cache.remove(trackId);
      await markStore.reset(trackId);
      res.json(record);
    } catch {
      res.status(400).json({ error: "Bad track id" });
    }
  });

  app.post("/api/lyrics-override/reset", async (req, res) => {
    const { trackId } = req.body ?? {};
    if (typeof trackId !== "string") {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      if (!(await overrideStore.remove(trackId))) {
        return res.status(404).json({ error: "Not overridden" });
      }
      await cache.remove(trackId);
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: "Bad track id" });
    }
  });

  app.post("/api/retranslate", async (req, res) => {
    const { trackId } = req.body ?? {};
    if (typeof trackId !== "string") {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      const entry = await cache.read(trackId);
      if (!entry) return res.status(404).json({ error: "Not cached" });
      const source = entry.lines.map((l) => l.editedEs ?? l.es);
      const { titleEn, en: fresh } = await translateLinesWithTitle(
        provider,
        source,
        {
          trackId,
          title: entry.title,
          artist: entry.artist,
        }
      );
      const updated = await cache.applyRetranslationAndWrite(
        trackId,
        titleEn,
        fresh
      );
      if (!updated) return res.status(404).json({ error: "Not cached" });
      res.json(updated);
    } catch (err: any) {
      const status = err instanceof TranslationFailedError ? 502 : 500;
      res.status(status).json({ error: err?.message || "Retranslation failed" });
    }
  });

  app.post("/api/override", async (req, res) => {
    const { trackId, lineIndex, field, text } = req.body ?? {};
    if (
      typeof trackId !== "string" ||
      typeof lineIndex !== "number" ||
      (field !== "es" && field !== "en") ||
      typeof text !== "string"
    ) {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      res.json(await cache.setOverride(trackId, lineIndex, field, text));
    } catch (err: any) {
      res.status(404).json({ error: err?.message || "Not found" });
    }
  });

  app.post("/api/override/reset", async (req, res) => {
    const { trackId, lineIndex, field } = req.body ?? {};
    if (
      typeof trackId !== "string" ||
      typeof lineIndex !== "number" ||
      (field !== "es" && field !== "en")
    ) {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      res.json(await cache.resetOverride(trackId, lineIndex, field));
    } catch (err: any) {
      res.status(404).json({ error: err?.message || "Not found" });
    }
  });

  return app;
}
