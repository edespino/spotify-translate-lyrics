import { mkdtempSync, rmSync } from "node:fs";
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

describe("translation server", () => {
  it("cache miss calls the provider exactly once and stores the result", async () => {
    const provider = providerWith(async (lines) =>
      lines.map((l) => `EN:${l}`)
    );
    const app = createApp(provider, dir);

    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
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

    await request(app).post("/api/translate").send(body);
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

    await request(app).post("/api/translate").send(body);
    await request(app)
      .post("/api/override")
      .send({ trackId: "abc123", lineIndex: 1, field: "es", text: "chao" });
    await request(app).post("/api/retranslate").send({ trackId: "abc123" });
    expect(sources[1]).toEqual(["hola", "chao"]);
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
