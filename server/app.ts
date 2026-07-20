import express from "express";
import { TranslationCache } from "./cache";
import { translateLines } from "./translator";
import type { TranslationEntry, TranslationProvider } from "./types";

export function createApp(provider: TranslationProvider, dataDir: string) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const cache = new TranslationCache(dataDir);

  // In-flight requests per track so a double-submit does not call the
  // provider twice.
  const inFlight = new Map<string, Promise<TranslationEntry>>();

  app.get("/api/translations/:trackId", async (req, res) => {
    try {
      const entry = await cache.read(req.params.trackId);
      if (!entry) return res.status(404).json({ error: "Not cached" });
      res.json(entry);
    } catch {
      res.status(400).json({ error: "Bad track id" });
    }
  });

  app.post("/api/translate", async (req, res) => {
    const { trackId, title, artist, lines, timesMs } = req.body ?? {};
    if (
      typeof trackId !== "string" ||
      !Array.isArray(lines) ||
      lines.some((l: unknown) => typeof l !== "string")
    ) {
      return res.status(400).json({ error: "Bad request" });
    }
    try {
      const cached = await cache.read(trackId);
      if (cached) return res.json(cached);

      let pending = inFlight.get(trackId);
      if (!pending) {
        pending = (async () => {
          const en = await translateLines(provider, lines, {
            trackId,
            title: String(title ?? ""),
            artist: String(artist ?? ""),
          });
          const entry: TranslationEntry = {
            trackId,
            title: String(title ?? ""),
            artist: String(artist ?? ""),
            lines: lines.map((es: string, i: number) => ({
              timeMs: Array.isArray(timesMs) ? Number(timesMs[i]) || 0 : 0,
              es,
              en: en[i] ?? "",
            })),
          };
          await cache.write(entry);
          return entry;
        })();
        inFlight.set(trackId, pending);
        pending.finally(() => inFlight.delete(trackId));
      }
      res.json(await pending);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Translation failed" });
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
      const fresh = await translateLines(provider, source, {
        trackId,
        title: entry.title,
        artist: entry.artist,
      });
      cache.applyRetranslation(entry, fresh);
      await cache.write(entry);
      res.json(entry);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Retranslation failed" });
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
