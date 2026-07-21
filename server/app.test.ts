import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import type { TranslationProvider } from "./types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "app-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function providerWith(
  impl: (lines: string[]) => Promise<string[]>
): TranslationProvider {
  return { translate: vi.fn(impl) };
}

const body = {
  trackId: "abc123",
  title: "Cancion",
  artist: "Artista",
  lines: ["hola", "adios"],
  timesMs: [0, 2000],
};

describe.sequential("translation server", () => {
  it("cache miss calls the provider exactly once and stores the result", async () => {
    const provider = providerWith(async (lines) =>
      lines.map((l) => `EN:${l}`)
    );
    const app = createApp(provider, dir);

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(res.body.titleEn).toBe("EN:Cancion");
    expect(res.body.lines).toEqual([
      { timeMs: 0, es: "hola", en: "EN:hola" },
      { timeMs: 2000, es: "adios", en: "EN:adios" },
    ]);
    expect(provider.translate).toHaveBeenCalledTimes(1);

    const got = await request(app).get("/api/translations/abc123");
    expect(got.status).toBe(200);
    expect(got.body.trackId).toBe("abc123");
  });

  it("cache hit does not call the provider", async () => {
    const provider = providerWith(async (lines) =>
      lines.map((l) => `EN:${l}`)
    );
    const app = createApp(provider, dir);

    await request(app).post("/api/translate").send(body);
    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(res.body.lines[0].en).toBe("EN:hola");
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("line-count mismatch triggers retry then chunked fallback", async () => {
    let call = 0;
    const provider = providerWith(async (lines) => {
      call++;
      if (call <= 2) return ["wrong count"];
      return lines.map((l) => `EN:${l}`);
    });
    const app = createApp(provider, dir);

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(res.body.lines.map((l: any) => l.en)).toEqual([
      "EN:hola",
      "EN:adios",
    ]);
    // 2 failed batch attempts + 1 chunk (both lines fit in one chunk)
    expect(call).toBe(3);
  });

  it("translation failure returns 502 and caches nothing", async () => {
    const provider = providerWith(async () => {
      throw new Error("provider down");
    });
    const app = createApp(provider, dir);

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(502);
    expect(res.body.error).toBeTruthy();

    const got = await request(app).get("/api/translations/abc123");
    expect(got.status).toBe(404);
  });

  it("a retry after a failure reaches the provider again and succeeds", async () => {
    let healthy = false;
    const provider = providerWith(async (lines) => {
      if (!healthy) throw new Error("provider down");
      return lines.map((l) => `EN:${l}`);
    });
    const app = createApp(provider, dir);

    expect((await request(app).post("/api/translate").send(body)).status).toBe(
      502
    );
    healthy = true;
    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(res.body.lines.map((l: any) => l.en)).toEqual([
      "EN:hola",
      "EN:adios",
    ]);
  });

  it("retranslate failure returns 502 and keeps the cached entry intact", async () => {
    let healthy = true;
    const provider = providerWith(async (lines) => {
      if (!healthy) throw new Error("provider down");
      return lines.map((l) => `EN:${l}`);
    });
    const app = createApp(provider, dir);

    const translated = await request(app).post("/api/translate").send(body);
    expect(translated.status).toBe(200);
    healthy = false;
    const res = await request(app)
      .post("/api/retranslate")
      .send({ trackId: "abc123" });
    expect(res.status).toBe(502);

    const got = await request(app).get("/api/translations/abc123");
    expect(got.status).toBe(200);
    expect(got.body.lines.map((l: any) => l.en)).toEqual([
      "EN:hola",
      "EN:adios",
    ]);
  });

  it("returns 404 for an uncached track", async () => {
    const app = createApp(providerWith(async (l) => l), dir);
    const res = await request(app).get("/api/translations/none");
    expect(res.status).toBe(404);
  });

  it("override then retranslate preserves the edited line", async () => {
    let pass = 0;
    const provider = providerWith(async (lines) => {
      pass++;
      return lines.map((l) => `EN${pass}:${l}`);
    });
    const app = createApp(provider, dir);

    await request(app).post("/api/translate").send(body);

    const edited = await request(app)
      .post("/api/override")
      .send({ trackId: "abc123", lineIndex: 0, field: "en", text: "my hello" });
    expect(edited.status).toBe(200);
    expect(edited.body.lines[0].editedEn).toBe("my hello");

    const re = await request(app)
      .post("/api/retranslate")
      .send({ trackId: "abc123" });
    expect(re.status).toBe(200);
    // Edited line untouched, other line refreshed by the second pass
    expect(re.body.lines[0].editedEn).toBe("my hello");
    expect(re.body.lines[0].en).toBe("EN1:hola");
    expect(re.body.lines[1].en).toBe("EN2:adios");
  });

  it("retranslate uses edited Spanish as the source", async () => {
    const sources: string[][] = [];
    const provider = providerWith(async (lines) => {
      sources.push(lines);
      return lines.map((l) => `EN:${l}`);
    });
    const app = createApp(provider, dir);

    const translated = await request(app).post("/api/translate").send(body);
    expect(translated.status).toBe(200);
    const edited = await request(app)
      .post("/api/override")
      .send({ trackId: "abc123", lineIndex: 1, field: "es", text: "chao" });
    expect(edited.status).toBe(200);
    const retrans = await request(app)
      .post("/api/retranslate")
      .send({ trackId: "abc123" });
    expect(retrans.status).toBe(200);
    // The title is prepended as the first batch line on every pass.
    expect(sources).toHaveLength(2);
    expect(sources[1]).toEqual(["Cancion", "hola", "chao"]);
  });

  it("reset removes an override", async () => {
    const provider = providerWith(async (lines) =>
      lines.map((l) => `EN:${l}`)
    );
    const app = createApp(provider, dir);

    await request(app).post("/api/translate").send(body);
    await request(app)
      .post("/api/override")
      .send({ trackId: "abc123", lineIndex: 0, field: "en", text: "mine" });
    const res = await request(app)
      .post("/api/override/reset")
      .send({ trackId: "abc123", lineIndex: 0, field: "en" });
    expect(res.status).toBe(200);
    expect(res.body.lines[0].editedEn).toBeUndefined();
    expect(res.body.lines[0].en).toBe("EN:hola");
  });

  it("prepends the title to the batch and writes titleEn to the cache", async () => {
    const sources: string[][] = [];
    const provider = providerWith(async (lines) => {
      sources.push(lines);
      return lines.map((l) => `EN:${l}`);
    });
    const app = createApp(provider, dir);

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(sources[0]).toEqual(["Cancion", "hola", "adios"]);
    expect(res.body.titleEn).toBe("EN:Cancion");

    const file = JSON.parse(
      readFileSync(path.join(dir, "translations", "abc123.json"), "utf8")
    );
    expect(file.titleEn).toBe("EN:Cancion");
    expect(file.lines.map((l: any) => l.en)).toEqual(["EN:hola", "EN:adios"]);
  });

  it("backfills titleEn for a pre-title cache entry and persists it", async () => {
    const sources: string[][] = [];
    const provider = providerWith(async (lines) => {
      sources.push(lines);
      return lines.map((l) => `EN:${l}`);
    });
    const app = createApp(provider, dir);
    mkdirSync(path.join(dir, "translations"), { recursive: true });
    writeFileSync(
      path.join(dir, "translations", "abc123.json"),
      JSON.stringify({
        trackId: "abc123",
        title: "Cancion",
        artist: "Artista",
        lines: [
          { timeMs: 0, es: "hola", en: "old hello" },
          { timeMs: 2000, es: "adios", en: "old bye" },
        ],
      })
    );

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(res.body.titleEn).toBe("EN:Cancion");
    expect(res.body.lines[0].en).toBe("old hello");
    expect(provider.translate).toHaveBeenCalledTimes(1);
    expect(sources).toEqual([["Cancion"]]);

    const file = JSON.parse(
      readFileSync(path.join(dir, "translations", "abc123.json"), "utf8")
    );
    expect(file.titleEn).toBe("EN:Cancion");
    expect(file.lines).toEqual([
      { timeMs: 0, es: "hola", en: "old hello" },
      { timeMs: 2000, es: "adios", en: "old bye" },
    ]);

    const got = await request(app).get("/api/translations/abc123");
    expect(got.status).toBe(200);
    expect(got.body.titleEn).toBe("EN:Cancion");
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("returns cached lyrics promptly when title backfill is slow", async () => {
    const provider = providerWith(
      async () => new Promise<string[]>(() => {})
    );
    const app = createApp(provider, dir);
    mkdirSync(path.join(dir, "translations"), { recursive: true });
    writeFileSync(
      path.join(dir, "translations", "abc123.json"),
      JSON.stringify({
        trackId: "abc123",
        title: "Cancion",
        artist: "Artista",
        lines: [{ timeMs: 0, es: "hola", en: "old hello" }],
      })
    );

    const startedAt = Date.now();
    const [firstRes, secondRes] = await Promise.all([
      request(app).post("/api/translate").send(body),
      request(app).get("/api/translations/abc123"),
    ]);
    const elapsedMs = Date.now() - startedAt;

    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
    expect(elapsedMs).toBeLessThan(2200);
    expect(firstRes.body.titleEn).toBeUndefined();
    expect(secondRes.body.titleEn).toBeUndefined();
    expect(firstRes.body.lines[0].en).toBe("old hello");
    expect(secondRes.body.lines[0].en).toBe("old hello");
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("returns cached lyrics when title backfill fails and leaves titleEn absent", async () => {
    const provider = providerWith(async () => {
      throw new Error("provider down");
    });
    const app = createApp(provider, dir);
    mkdirSync(path.join(dir, "translations"), { recursive: true });
    writeFileSync(
      path.join(dir, "translations", "abc123.json"),
      JSON.stringify({
        trackId: "abc123",
        title: "Cancion",
        artist: "Artista",
        lines: [{ timeMs: 0, es: "hola", en: "old hello" }],
      })
    );

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(res.body.titleEn).toBeUndefined();
    expect(res.body.lines[0].en).toBe("old hello");
    expect(provider.translate).toHaveBeenCalledTimes(1);

    const file = JSON.parse(
      readFileSync(path.join(dir, "translations", "abc123.json"), "utf8")
    );
    expect(file.titleEn).toBeUndefined();
    expect(file.lines[0].en).toBe("old hello");
  });

  it("does not call the provider for a cached entry with titleEn", async () => {
    const provider = providerWith(async (lines) =>
      lines.map((l) => `EN:${l}`)
    );
    const app = createApp(provider, dir);
    mkdirSync(path.join(dir, "translations"), { recursive: true });
    writeFileSync(
      path.join(dir, "translations", "abc123.json"),
      JSON.stringify({
        trackId: "abc123",
        title: "Cancion",
        artist: "Artista",
        titleEn: "Song",
        lines: [{ timeMs: 0, es: "hola", en: "old hello" }],
      })
    );

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(res.body.titleEn).toBe("Song");
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it("single-flights concurrent title backfills for the same track", async () => {
    let resolveTitle: ((value: string[]) => void) | undefined;
    const provider = providerWith(
      async (lines) =>
        new Promise<string[]>((resolve) => {
          resolveTitle = resolve;
        }).then(() => lines.map((l) => `EN:${l}`))
    );
    const app = createApp(provider, dir);
    mkdirSync(path.join(dir, "translations"), { recursive: true });
    writeFileSync(
      path.join(dir, "translations", "abc123.json"),
      JSON.stringify({
        trackId: "abc123",
        title: "Cancion",
        artist: "Artista",
        lines: [{ timeMs: 0, es: "hola", en: "old hello" }],
      })
    );

    const responses = Promise.all([
      request(app).post("/api/translate").send(body),
      request(app).post("/api/translate").send(body),
    ]);
    while (!resolveTitle) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(provider.translate).toHaveBeenCalledTimes(1);
    resolveTitle([]);

    const [firstRes, secondRes] = await responses;
    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
    expect(firstRes.body.titleEn).toBe("EN:Cancion");
    expect(secondRes.body.titleEn).toBe("EN:Cancion");
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("keeps an override written during title backfill", async () => {
    const provider = providerWith(async (lines) =>
      lines.map((l) => `EN:${l}`)
    );
    const app = createApp(provider, dir);
    mkdirSync(path.join(dir, "translations"), { recursive: true });
    writeFileSync(
      path.join(dir, "translations", "abc123.json"),
      JSON.stringify({
        trackId: "abc123",
        title: "Cancion",
        artist: "Artista",
        lines: [{ timeMs: 0, es: "hola", en: "old hello" }],
      })
    );

    const realWriteFile = fs.writeFile.bind(fs);
    let releaseTitleWrite: (() => void) | undefined;
    const writeFile = vi.spyOn(fs, "writeFile").mockImplementation(
      async (
        file: Parameters<typeof fs.writeFile>[0],
        data: Parameters<typeof fs.writeFile>[1],
        options?: Parameters<typeof fs.writeFile>[2]
      ) => {
        const text = typeof data === "string" ? data : data.toString();
        if (
          text.includes('"titleEn": "EN:Cancion"') &&
          !text.includes("editedEn") &&
          releaseTitleWrite === undefined
        ) {
          await new Promise<void>((resolve) => {
            releaseTitleWrite = resolve;
          });
        }
        return realWriteFile(file, data, options);
      }
    );

    try {
      const backfill = request(app)
        .post("/api/translate")
        .send(body)
        .then((res) => res);
      while (!releaseTitleWrite) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      let overrideDone = false;
      const override = request(app)
        .post("/api/override")
        .send({
          trackId: "abc123",
          lineIndex: 0,
          field: "en",
          text: "my hello",
        })
        .then((res) => {
          overrideDone = true;
          return res;
        });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(overrideDone).toBe(false);
      releaseTitleWrite();

      const [backfillRes, overrideRes] = await Promise.all([
        backfill,
        override,
      ]);
      expect(backfillRes.status).toBe(200);
      expect(overrideRes.status).toBe(200);

      const file = JSON.parse(
        readFileSync(path.join(dir, "translations", "abc123.json"), "utf8")
      );
      expect(file.titleEn).toBe("EN:Cancion");
      expect(file.lines[0].en).toBe("old hello");
      expect(file.lines[0].editedEn).toBe("my hello");
    } finally {
      writeFile.mockRestore();
    }
  });

  it("retranslate refreshes titleEn, including on a pre-title cache entry", async () => {
    let pass = 0;
    const provider = providerWith(async (lines) => {
      pass++;
      return lines.map((l) => `EN${pass}:${l}`);
    });
    const app = createApp(provider, dir);
    mkdirSync(path.join(dir, "translations"), { recursive: true });
    writeFileSync(
      path.join(dir, "translations", "abc123.json"),
      JSON.stringify({
        trackId: "abc123",
        title: "Cancion",
        artist: "Artista",
        lines: [{ timeMs: 0, es: "hola", en: "old hello" }],
      })
    );

    const res = await request(app)
      .post("/api/retranslate")
      .send({ trackId: "abc123" });
    expect(res.status).toBe(200);
    expect(res.body.titleEn).toBe("EN1:Cancion");
    expect(res.body.lines[0].en).toBe("EN1:hola");

    const file = JSON.parse(
      readFileSync(path.join(dir, "translations", "abc123.json"), "utf8")
    );
    expect(file.titleEn).toBe("EN1:Cancion");
  });

  it("rejects malformed requests", async () => {
    const app = createApp(providerWith(async (l) => l), dir);
    expect(
      (await request(app).post("/api/translate").send({ trackId: "x" })).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/override")
          .send({ trackId: "x", lineIndex: 0, field: "fr", text: "a" })
      ).status
    ).toBe(400);
    expect(
      (await request(app).get("/api/translations/..%2Fescape")).status
    ).toBe(400);
  });
});
