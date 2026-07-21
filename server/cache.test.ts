import { mkdtempSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlossCache, glossCacheKey, TranslationCache } from "./cache";
import type { TranslationEntry } from "./types";

let dir: string;
let cache: TranslationCache;
let glossCache: GlossCache;

const entry = (): TranslationEntry => ({
  trackId: "track1",
  title: "Cancion",
  artist: "Artista",
  lines: [
    { timeMs: 0, es: "hola", en: "hello" },
    { timeMs: 1000, es: "adios", en: "goodbye" },
  ],
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cache-test-"));
  cache = new TranslationCache(dir);
  glossCache = new GlossCache(dir);
});

describe("GlossCache", () => {
  it("round-trips a gloss entry by normalized key", async () => {
    const key = glossCacheKey("Corazon", "Mi corazon late");
    expect(key).toBe(glossCacheKey("corazon", "mi corazon late"));

    const entry = {
      word: "Corazon",
      gloss: "heart",
      partOfSpeech: "noun",
      note: "",
    };
    await glossCache.write(key, entry);
    expect(await glossCache.read(key)).toEqual(entry);
  });

  it("keeps formerly ambiguous word and context pairs distinct", async () => {
    const firstKey = glossCacheKey("a", "aaa a");
    const secondKey = glossCacheKey("aa", "aa a");
    expect(firstKey).not.toBe(secondKey);

    await glossCache.write(firstKey, {
      word: "a",
      gloss: "first",
      partOfSpeech: "noun",
      note: "",
    });
    await glossCache.write(secondKey, {
      word: "aa",
      gloss: "second",
      partOfSpeech: "noun",
      note: "",
    });

    expect((await glossCache.read(firstKey))?.gloss).toBe("first");
    expect((await glossCache.read(secondKey))?.gloss).toBe("second");
  });

  it("returns null for a missing gloss", async () => {
    expect(await glossCache.read(glossCacheKey("luz", "dame luz"))).toBeNull();
  });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("TranslationCache", () => {
  it("returns null for a missing entry", async () => {
    expect(await cache.read("nope")).toBeNull();
  });

  it("round-trips an entry", async () => {
    await cache.write(entry());
    expect(await cache.read("track1")).toEqual(entry());
  });

  it("cleans up temp files after a failed write", async () => {
    const realWriteFile = fs.writeFile.bind(fs);
    const writeFile = vi.spyOn(fs, "writeFile").mockImplementation(
      async (
        file: Parameters<typeof fs.writeFile>[0],
        data: Parameters<typeof fs.writeFile>[1],
        options?: Parameters<typeof fs.writeFile>[2]
      ) => {
        await realWriteFile(file, data, options);
        throw new Error("disk full");
      }
    );

    try {
      await expect(cache.write(entry())).rejects.toThrow("disk full");
      expect(await fs.readdir(path.join(dir, "translations"))).toEqual([]);
    } finally {
      writeFile.mockRestore();
    }
  });

  it("rejects path traversal track ids", async () => {
    await expect(cache.read("../etc/passwd")).rejects.toThrow();
    await expect(
      cache.write({ ...entry(), trackId: "a/b" })
    ).rejects.toThrow();
  });

  it("sets and resets overrides", async () => {
    await cache.write(entry());
    let e = await cache.setOverride("track1", 0, "en", "hi there");
    expect(e.lines[0].editedEn).toBe("hi there");
    expect(e.lines[0].en).toBe("hello");

    e = await cache.setOverride("track1", 1, "es", "chao");
    expect(e.lines[1].editedEs).toBe("chao");

    e = await cache.resetOverride("track1", 0, "en");
    expect(e.lines[0].editedEn).toBeUndefined();

    const stored = await cache.read("track1");
    expect(stored?.lines[0].editedEn).toBeUndefined();
    expect(stored?.lines[1].editedEs).toBe("chao");
  });

  it("throws when overriding a missing line", async () => {
    await cache.write(entry());
    await expect(cache.setOverride("track1", 99, "en", "x")).rejects.toThrow();
    await expect(cache.setOverride("nope", 0, "en", "x")).rejects.toThrow();
  });

  it("retranslation skips lines with an English override", async () => {
    const e = entry();
    e.lines[0].editedEn = "my version";
    cache.applyRetranslation(e, ["fresh hello", "fresh goodbye"]);
    expect(e.lines[0].en).toBe("hello");
    expect(e.lines[0].editedEn).toBe("my version");
    expect(e.lines[1].en).toBe("fresh goodbye");
  });
});
