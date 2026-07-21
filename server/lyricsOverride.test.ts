import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createTestRequest } from "./testRequest";
import type { TranslationProvider } from "./types";

let dir: string;
const { closeServers, request } = createTestRequest();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lyrics-override-test-"));
});

afterEach(async () => {
  await closeServers();
  rmSync(dir, { recursive: true, force: true });
});

function providerWith(
  impl: (lines: string[]) => Promise<string[]>
): TranslationProvider {
  return {
    translate: vi.fn(impl),
    glossWord: vi.fn(async (word) => ({
      word,
      gloss: "meaning",
      partOfSpeech: "noun",
      note: "",
    })),
  };
}

const echoProvider = () =>
  providerWith(async (lines) => lines.map((l) => `EN:${l}`));

// The LRCLIB entry intermixes English blocks around the real Spanish
// lines; the override keeps only the Spanish middle.
const translateBody = {
  trackId: "trk1",
  title: "La Feria",
  artist: "Los Lobos",
  lines: ["english top", "hola", "adios", "english bottom"],
  timesMs: [0, 1000, 2000, 3000],
  lrclibId: 4242,
};

const overrideBody = {
  trackId: "trk1",
  title: "La Feria",
  artist: "Los Lobos",
  kind: "synced",
  lines: [
    { timeMs: 1000, text: "hola" },
    { timeMs: 2000, text: "adios" },
  ],
  lrclibId: 4242,
};

describe.sequential("lyric-source overrides", () => {
  it("save stores the record, deletes the cache, and translate uses the override once", async () => {
    const provider = echoProvider();
    const app = createApp(provider, dir);

    // Prime a translation of the wrong LRCLIB lines.
    await request(app).post("/api/translate").send(translateBody);
    const cacheFile = path.join(dir, "translations", "trk1.json");
    expect(existsSync(cacheFile)).toBe(true);
    expect(provider.translate).toHaveBeenCalledTimes(1);

    const saved = await request(app)
      .post("/api/lyrics-override")
      .send(overrideBody);
    expect(saved.status).toBe(200);
    expect(saved.body.trackId).toBe("trk1");
    expect(saved.body.kind).toBe("synced");
    expect(saved.body.lrclibId).toBe(4242);
    expect(typeof saved.body.savedAt).toBe("string");
    // Save invalidates the translation cache.
    expect(existsSync(cacheFile)).toBe(false);

    const list = await request(app).get("/api/lyrics-overrides");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].trackId).toBe("trk1");
    expect(list.body[0].lines).toBeUndefined();

    const record = await request(app).get("/api/lyrics-overrides/trk1");
    expect(record.status).toBe(200);
    expect(record.body.lines).toHaveLength(2);

    // Translate again: exactly one fresh provider call, over the
    // override lines even though the body still carries the LRCLIB
    // ones.
    const res = await request(app).post("/api/translate").send(translateBody);
    expect(res.status).toBe(200);
    expect(provider.translate).toHaveBeenCalledTimes(2);
    expect(res.body.lines.map((l: any) => l.es)).toEqual(["hola", "adios"]);
    expect(res.body.lines.map((l: any) => l.timeMs)).toEqual([1000, 2000]);
    const translated = provider.translate as ReturnType<typeof vi.fn>;
    const sentLines = translated.mock.calls[1][0] as string[];
    expect(sentLines).not.toContain("english top");
    expect(sentLines).toContain("hola");

    // The fresh translation is cached; a third call is served from disk.
    await request(app).post("/api/translate").send(translateBody);
    expect(provider.translate).toHaveBeenCalledTimes(2);
  });

  it("save clears a wrong-lyrics mark: fixing supersedes suppressing", async () => {
    const provider = echoProvider();
    const app = createApp(provider, dir);

    await request(app)
      .post("/api/mark")
      .send({ trackId: "trk1", title: "La Feria", artist: "Los Lobos" });
    const blocked = await request(app)
      .post("/api/translate")
      .send(translateBody);
    expect(blocked.status).toBe(409);

    const saved = await request(app)
      .post("/api/lyrics-override")
      .send(overrideBody);
    expect(saved.status).toBe(200);

    const marksLeft = await request(app).get("/api/marks");
    expect(marksLeft.body).toHaveLength(0);

    const res = await request(app).post("/api/translate").send(translateBody);
    expect(res.status).toBe(200);
    expect(res.body.lines.map((l: any) => l.es)).toEqual(["hola", "adios"]);
  });

  it("restore removes the override, invalidates the cache, and LRCLIB lines translate again", async () => {
    const provider = echoProvider();
    const app = createApp(provider, dir);

    await request(app).post("/api/lyrics-override").send(overrideBody);
    await request(app).post("/api/translate").send(translateBody);
    const cacheFile = path.join(dir, "translations", "trk1.json");
    expect(existsSync(cacheFile)).toBe(true);

    const reset = await request(app)
      .post("/api/lyrics-override/reset")
      .send({ trackId: "trk1" });
    expect(reset.status).toBe(200);
    expect(existsSync(cacheFile)).toBe(false);

    const list = await request(app).get("/api/lyrics-overrides");
    expect(list.body).toHaveLength(0);
    expect(
      (await request(app).get("/api/lyrics-overrides/trk1")).status
    ).toBe(404);

    // Back on the normal flow: the request body (LRCLIB lines) is the
    // source again and translates fresh.
    const res = await request(app).post("/api/translate").send(translateBody);
    expect(res.status).toBe(200);
    expect(provider.translate).toHaveBeenCalledTimes(2);
    expect(res.body.lines.map((l: any) => l.es)).toEqual(translateBody.lines);
  });

  it("reset of a track without an override answers 404", async () => {
    const app = createApp(echoProvider(), dir);
    const res = await request(app)
      .post("/api/lyrics-override/reset")
      .send({ trackId: "none1" });
    expect(res.status).toBe(404);
  });

  it("save validates the body", async () => {
    const app = createApp(echoProvider(), dir);
    const bad = async (body: unknown) =>
      (await request(app).post("/api/lyrics-override").send(body as object))
        .status;
    expect(await bad({})).toBe(400);
    expect(await bad({ ...overrideBody, trackId: 5 })).toBe(400);
    expect(await bad({ ...overrideBody, trackId: "../x" })).toBe(400);
    expect(await bad({ ...overrideBody, kind: "weird" })).toBe(400);
    expect(await bad({ ...overrideBody, lines: [] })).toBe(400);
    expect(await bad({ ...overrideBody, lines: [{ timeMs: -1, text: "a" }] })).toBe(400);
    expect(await bad({ ...overrideBody, lines: [{ timeMs: 0, text: 7 }] })).toBe(400);
  });

  it("an override without an lrclibId falls back to the cache entry's", async () => {
    const app = createApp(echoProvider(), dir);
    await request(app).post("/api/translate").send(translateBody);
    // JSON serialization drops the undefined key, so the request body
    // carries no lrclibId at all.
    const noId = { ...overrideBody, lrclibId: undefined };
    const saved = await request(app).post("/api/lyrics-override").send(noId);
    expect(saved.status).toBe(200);
    expect(saved.body.lrclibId).toBe(4242);
  });

  it("saving during an in-flight translate does not resurrect the stale cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const provider = providerWith(async (lines) => {
      // Only the first (pre-override) translation waits on the gate.
      if (++calls === 1) await gate;
      return lines.map((l) => `EN:${l}`);
    });
    const app = createApp(provider, dir);

    const pending = request(app)
      .post("/api/translate")
      .send(translateBody)
      .then((r) => r);
    await vi.waitFor(() => expect(provider.translate).toHaveBeenCalled());

    const saved = await request(app)
      .post("/api/lyrics-override")
      .send(overrideBody);
    expect(saved.status).toBe(200);

    release();
    const res = await pending;
    // The client that asked still gets its (stale) translation; it is
    // just never persisted.
    expect(res.status).toBe(200);
    expect(res.body.lines[0].es).toBe("english top");
    const cacheFile = path.join(dir, "translations", "trk1.json");
    expect(existsSync(cacheFile)).toBe(false);

    // The next translate call runs fresh over the override lines.
    const fresh = await request(app).post("/api/translate").send(translateBody);
    expect(fresh.status).toBe(200);
    expect(fresh.body.lines.map((l: any) => l.es)).toEqual(["hola", "adios"]);
    expect(provider.translate).toHaveBeenCalledTimes(2);
  });
});
