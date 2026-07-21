import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { glossCacheKey } from "./cache";
import type { TranslationProvider } from "./types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "vocab-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const provider: TranslationProvider = {
  translate: async (lines) => lines,
  glossWord: async (word) => ({
    word,
    gloss: "meaning",
    partOfSpeech: "noun",
    note: "",
  }),
};

const entryBody = {
  word: "corazon",
  gloss: "heart",
  partOfSpeech: "noun",
  note: "figurative here",
  contextLine: "Mi corazon late por ti",
  trackId: "abc123",
  trackTitle: "Cancion",
  artist: "Artista",
};

function makeApp() {
  return createApp(provider, dir);
}

describe.sequential("vocab endpoints", () => {
  it("adds an entry, stamps id and savedAt, and lists it", async () => {
    const app = makeApp();

    const res = await request(app).post("/api/vocab").send(entryBody);
    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(false);
    expect(res.body.entry).toMatchObject(entryBody);
    expect(res.body.entry.id).toMatch(/^[0-9a-f]{40}$/);
    expect(res.body.entry.id).toBe(
      glossCacheKey(entryBody.word, entryBody.contextLine)
    );
    expect(Number.isNaN(Date.parse(res.body.entry.savedAt))).toBe(false);

    const list = await request(app).get("/api/vocab");
    expect(list.status).toBe(200);
    expect(list.body).toEqual([res.body.entry]);
  });

  it("lists entries newest first", async () => {
    const app = makeApp();

    await request(app).post("/api/vocab").send(entryBody);
    await request(app)
      .post("/api/vocab")
      .send({ ...entryBody, word: "late", contextLine: "Mi corazon late" });

    const list = await request(app).get("/api/vocab");
    expect(list.body.map((e: { word: string }) => e.word)).toEqual([
      "late",
      "corazon",
    ]);
  });

  it("returns an empty list before anything is saved", async () => {
    const res = await request(makeApp()).get("/api/vocab");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("dedupes an exact repeat with duplicate:true and no second entry", async () => {
    const app = makeApp();

    const first = await request(app).post("/api/vocab").send(entryBody);
    const second = await request(app).post("/api/vocab").send(entryBody);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.entry).toEqual(first.body.entry);

    const list = await request(app).get("/api/vocab");
    expect(list.body).toHaveLength(1);
  });

  it("dedupes case, accent, and whitespace variants of word+context", async () => {
    const app = makeApp();

    await request(app).post("/api/vocab").send(entryBody);
    const variant = await request(app).post("/api/vocab").send({
      ...entryBody,
      word: "Corazón",
      contextLine: "  Mi   CORAZON late por ti ",
    });
    expect(variant.status).toBe(200);
    expect(variant.body.duplicate).toBe(true);

    const list = await request(app).get("/api/vocab");
    expect(list.body).toHaveLength(1);
  });

  it("updates the stored entry on a duplicate save, keeping id and savedAt", async () => {
    const app = makeApp();

    const first = await request(app).post("/api/vocab").send(entryBody);
    const updated = await request(app)
      .post("/api/vocab")
      .send({ ...entryBody, gloss: "heart (organ)", note: "anatomical" });
    expect(updated.status).toBe(200);
    expect(updated.body.duplicate).toBe(true);
    expect(updated.body.entry.gloss).toBe("heart (organ)");
    expect(updated.body.entry.note).toBe("anatomical");
    expect(updated.body.entry.id).toBe(first.body.entry.id);
    expect(updated.body.entry.savedAt).toBe(first.body.entry.savedAt);

    const list = await request(app).get("/api/vocab");
    expect(list.body).toEqual([updated.body.entry]);
  });

  it("does not dedupe the same word in a different context", async () => {
    const app = makeApp();

    await request(app).post("/api/vocab").send(entryBody);
    const other = await request(app)
      .post("/api/vocab")
      .send({ ...entryBody, contextLine: "Otro corazon distinto" });
    expect(other.body.duplicate).toBe(false);

    const list = await request(app).get("/api/vocab");
    expect(list.body).toHaveLength(2);
  });

  it("deletes by id, 404s a second delete, 400s a malformed id", async () => {
    const app = makeApp();

    const saved = await request(app).post("/api/vocab").send(entryBody);
    const id = saved.body.entry.id;

    const del = await request(app).delete(`/api/vocab/${id}`);
    expect(del.status).toBe(200);
    expect((await request(app).get("/api/vocab")).body).toEqual([]);

    expect((await request(app).delete(`/api/vocab/${id}`)).status).toBe(404);
    expect((await request(app).delete("/api/vocab/not-a-sha")).status).toBe(
      400
    );
  });

  it("rejects malformed add requests with 400", async () => {
    const app = makeApp();
    for (const payload of [
      {},
      { ...entryBody, word: "" },
      { ...entryBody, word: "   " },
      { ...entryBody, gloss: "" },
      { ...entryBody, contextLine: "" },
      { ...entryBody, word: "a".repeat(65) },
      { ...entryBody, contextLine: "b".repeat(501) },
      { ...entryBody, gloss: "c".repeat(501) },
      { ...entryBody, note: 5 },
      { ...entryBody, trackTitle: ["x"] },
    ]) {
      const res = await request(app).post("/api/vocab").send(payload);
      expect(res.status).toBe(400);
    }
    expect((await request(app).get("/api/vocab")).body).toEqual([]);
  });

  it("defaults omitted optional fields to empty strings", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/vocab").send({
      word: "luz",
      gloss: "light",
      contextLine: "Dame luz en la noche",
    });
    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({
      partOfSpeech: "",
      note: "",
      trackId: "",
      trackTitle: "",
      artist: "",
    });
  });

  it("persists to data/vocab.json atomically (no tmp files left behind)", async () => {
    const app = makeApp();

    await request(app).post("/api/vocab").send(entryBody);
    const file = JSON.parse(readFileSync(path.join(dir, "vocab.json"), "utf8"));
    expect(file).toHaveLength(1);
    expect(file[0].word).toBe("corazon");
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("keeps every entry under concurrent adds", async () => {
    const app = makeApp();
    const words = ["uno", "dos", "tres", "cuatro", "cinco"];

    const responses = await Promise.all(
      words.map((word) =>
        request(app)
          .post("/api/vocab")
          .send({ ...entryBody, word, contextLine: `linea con ${word}` })
      )
    );
    for (const res of responses) expect(res.status).toBe(200);

    const list = await request(app).get("/api/vocab");
    expect(list.body).toHaveLength(words.length);
    expect(new Set(list.body.map((e: { word: string }) => e.word))).toEqual(
      new Set(words)
    );
  });
});
