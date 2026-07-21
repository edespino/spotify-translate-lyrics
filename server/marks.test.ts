import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { hashMeetsTarget } from "./lrclibFlag";
import { createTestRequest } from "./testRequest";
import type { TranslationProvider } from "./types";

let dir: string;
const { closeServers, request } = createTestRequest();

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "marks-test-"));
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

const body = {
  trackId: "abc123",
  title: "Cancion",
  artist: "Artista",
  lines: ["hola", "adios"],
  timesMs: [0, 2000],
  lrclibId: 4242,
};

// Mock of the two LRCLIB write endpoints the report flow touches. Tests
// never call the real service. The easy all-ff target lets the solver
// finish at nonce 0.
const EASY_TARGET = "ff".repeat(32);

interface FlagCall {
  headers: Record<string, string | string[] | undefined>;
  body: any;
}

interface LrclibMock {
  baseUrl: string;
  close: () => Promise<void>;
  challengeCalls: () => number;
  flagCalls: () => FlagCall[];
}

function startLrclibMock(opts: {
  challengeStatus?: number;
  target?: string;
}): Promise<LrclibMock> {
  const challenges: number[] = [];
  const flags: FlagCall[] = [];
  const mock = express();
  mock.use(express.json());
  mock.post("/api/request-challenge", (_req, res) => {
    challenges.push(1);
    if (opts.challengeStatus) {
      return res.status(opts.challengeStatus).json({ error: "down" });
    }
    res.json({ prefix: "testprefix", target: opts.target ?? EASY_TARGET });
  });
  mock.post("/api/flag", (req, res) => {
    flags.push({ headers: req.headers, body: req.body });
    res.json({ ok: true });
  });
  return new Promise((resolve) => {
    const server: Server = createServer(mock).listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done, fail) =>
            server.close((err) => (err ? fail(err) : done()))
          ),
        challengeCalls: () => challenges.length,
        flagCalls: () => flags,
      });
    });
  });
}

describe.sequential("wrong-lyrics marks", () => {
  it("mark records the track, deletes the cache, and blocks translate", async () => {
    const provider = echoProvider();
    const app = createApp(provider, dir);

    await request(app).post("/api/translate").send(body);
    const cacheFile = path.join(dir, "translations", "abc123.json");
    expect(existsSync(cacheFile)).toBe(true);

    const marked = await request(app)
      .post("/api/mark")
      .send({ trackId: "abc123", title: "Cancion", artist: "Artista" });
    expect(marked.status).toBe(200);
    expect(marked.body.trackId).toBe("abc123");
    // lrclibId falls back to the cache entry captured at translate time.
    expect(marked.body.lrclibId).toBe(4242);
    expect(typeof marked.body.markedAt).toBe("string");
    expect(existsSync(cacheFile)).toBe(false);

    const list = await request(app).get("/api/marks");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const blocked = await request(app).post("/api/translate").send(body);
    expect(blocked.status).toBe(409);
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it("mark without a cache entry stores the lrclibId from the request", async () => {
    const app = createApp(echoProvider(), dir);
    const res = await request(app)
      .post("/api/mark")
      .send({ trackId: "nocache1", title: "T", artist: "A", lrclibId: 99 });
    expect(res.status).toBe(200);
    expect(res.body.lrclibId).toBe(99);
  });

  it("reset clears the mark and translate runs fresh", async () => {
    const provider = echoProvider();
    const app = createApp(provider, dir);

    await request(app).post("/api/translate").send(body);
    await request(app).post("/api/mark").send({ trackId: "abc123" });

    const reset = await request(app)
      .post("/api/mark/reset")
      .send({ trackId: "abc123" });
    expect(reset.status).toBe(200);

    const list = await request(app).get("/api/marks");
    expect(list.body).toHaveLength(0);

    // The cache was deleted at mark time, so this is a fresh provider
    // call, picking up whatever LRCLIB now serves.
    const res = await request(app).post("/api/translate").send(body);
    expect(res.status).toBe(200);
    expect(provider.translate).toHaveBeenCalledTimes(2);
  });

  it("reset of an unmarked track answers 404", async () => {
    const app = createApp(echoProvider(), dir);
    const res = await request(app)
      .post("/api/mark/reset")
      .send({ trackId: "nope" });
    expect(res.status).toBe(404);
  });

  it("mark and reset validate the body", async () => {
    const app = createApp(echoProvider(), dir);
    expect((await request(app).post("/api/mark").send({})).status).toBe(400);
    expect(
      (await request(app).post("/api/mark/reset").send({})).status
    ).toBe(400);
    expect(
      (await request(app).post("/api/mark").send({ trackId: "../x" })).status
    ).toBe(400);
  });

  it("report solves the challenge and flags the LRCLIB entry once", async () => {
    const lrclib = await startLrclibMock({});
    try {
      const app = createApp(echoProvider(), dir, {}, {
        lrclibBaseUrl: lrclib.baseUrl,
      });
      await request(app)
        .post("/api/mark")
        .send({ trackId: "abc123", lrclibId: 4242 });

      const res = await request(app)
        .post("/api/mark/report")
        .send({ trackId: "abc123" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      expect(lrclib.challengeCalls()).toBe(1);
      const flags = lrclib.flagCalls();
      expect(flags).toHaveLength(1);
      expect(flags[0].body.trackId).toBe(4242);
      expect(typeof flags[0].body.content).toBe("string");
      expect(flags[0].body.content.length).toBeGreaterThan(0);
      expect(flags[0].headers["lrclib-client"]).toContain(
        "spotify-translate-lyrics"
      );

      const token = String(flags[0].headers["x-publish-token"]);
      const [prefix, nonce] = token.split(":");
      expect(prefix).toBe("testprefix");
      const hash = createHash("sha256")
        .update(prefix + nonce)
        .digest("hex");
      expect(hashMeetsTarget(hash, EASY_TARGET)).toBe(true);
    } finally {
      await lrclib.close();
    }
  });

  it("report answers 502 on LRCLIB failure without retrying", async () => {
    const lrclib = await startLrclibMock({ challengeStatus: 503 });
    try {
      const app = createApp(echoProvider(), dir, {}, {
        lrclibBaseUrl: lrclib.baseUrl,
      });
      await request(app)
        .post("/api/mark")
        .send({ trackId: "abc123", lrclibId: 4242 });

      const res = await request(app)
        .post("/api/mark/report")
        .send({ trackId: "abc123" });
      expect(res.status).toBe(502);
      expect(lrclib.challengeCalls()).toBe(1);
      expect(lrclib.flagCalls()).toHaveLength(0);
    } finally {
      await lrclib.close();
    }
  });

  it("report answers 502 when the solve budget runs out", async () => {
    const lrclib = await startLrclibMock({ target: "00".repeat(32) });
    try {
      const app = createApp(echoProvider(), dir, {}, {
        lrclibBaseUrl: lrclib.baseUrl,
        flagSolveBudget: { maxAttempts: 50 },
      });
      await request(app)
        .post("/api/mark")
        .send({ trackId: "abc123", lrclibId: 4242 });

      const res = await request(app)
        .post("/api/mark/report")
        .send({ trackId: "abc123" });
      expect(res.status).toBe(502);
      expect(lrclib.flagCalls()).toHaveLength(0);
    } finally {
      await lrclib.close();
    }
  });

  it("report answers 409 when the mark has no lrclibId", async () => {
    const app = createApp(echoProvider(), dir);
    await request(app).post("/api/mark").send({ trackId: "noid1" });
    const res = await request(app)
      .post("/api/mark/report")
      .send({ trackId: "noid1" });
    expect(res.status).toBe(409);
  });

  it("report answers 404 for an unmarked track", async () => {
    const app = createApp(echoProvider(), dir);
    const res = await request(app)
      .post("/api/mark/report")
      .send({ trackId: "unmarked1" });
    expect(res.status).toBe(404);
  });
});
