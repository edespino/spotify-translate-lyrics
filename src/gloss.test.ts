import { describe, expect, it, vi } from "vitest";
import {
  GlossInvalidError,
  GlossUnavailableError,
  createGlossClient,
  glossKey,
  isAbortError,
} from "./gloss";

const entry = {
  word: "corazon",
  gloss: "heart",
  partOfSpeech: "noun",
  note: "",
};

function okResponse(body: unknown = entry) {
  return { ok: true, status: 200, json: async () => body };
}

function errorResponse(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

describe("glossKey", () => {
  it("is case-insensitive on the word", () => {
    expect(glossKey("Amor", "Un amor asi")).toBe(glossKey("amor", "Un amor asi"));
  });

  it("normalizes composed and decomposed accents", () => {
    expect(glossKey("coraz\u00f3n", "l\u00ednea uno")).toBe(
      glossKey("corazo\u0301n", "li\u0301nea uno")
    );
    expect(glossKey("ni\u00f1o", "el ni\u00f1o")).toBe(
      glossKey("nin\u0303o", "el nin\u0303o")
    );
  });

  it("collapses whitespace in the context only", () => {
    expect(glossKey("sol", "  el   sol \t sale ")).toBe(
      glossKey("sol", "el sol sale")
    );
  });

  it("keeps different contexts distinct", () => {
    expect(glossKey("sol", "el sol sale")).not.toBe(glossKey("sol", "bajo el sol"));
  });
});

describe("fetchGloss", () => {
  it("posts word and context to /api/gloss and returns the entry", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const { fetchGloss } = createGlossClient(fetchFn);
    const result = await fetchGloss("corazon", "Mi corazon late");
    expect(result).toEqual(entry);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [
      string,
      { method: string; body: string }
    ];
    expect(url).toBe("/api/gloss");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      word: "corazon",
      context: "Mi corazon late",
    });
  });

  it("serves repeat lookups from the in-memory cache", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const { fetchGloss } = createGlossClient(fetchFn);
    await fetchGloss("corazon", "Mi corazon late");
    const again = await fetchGloss("Corazon", "Mi  corazon late");
    expect(again).toEqual(entry);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent requests through the in-flight map", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetchFn = vi.fn(async () => {
      await gate;
      return okResponse();
    });
    const { fetchGloss } = createGlossClient(fetchFn);
    const a = fetchGloss("luz", "Dame luz");
    const b = fetchGloss("luz", "Dame luz");
    release();
    expect(await a).toEqual(entry);
    expect(await b).toEqual(entry);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("maps 400 to GlossInvalidError", async () => {
    const { fetchGloss } = createGlossClient(async () => errorResponse(400));
    await expect(fetchGloss("x", "y")).rejects.toBeInstanceOf(GlossInvalidError);
  });

  it("maps 502 to GlossUnavailableError", async () => {
    const { fetchGloss } = createGlossClient(async () => errorResponse(502));
    await expect(fetchGloss("x", "y")).rejects.toBeInstanceOf(
      GlossUnavailableError
    );
  });

  it("maps a network failure to GlossUnavailableError", async () => {
    const { fetchGloss } = createGlossClient(async () => {
      throw new TypeError("network down");
    });
    await expect(fetchGloss("x", "y")).rejects.toBeInstanceOf(
      GlossUnavailableError
    );
  });

  it("maps a malformed body to GlossUnavailableError", async () => {
    const { fetchGloss } = createGlossClient(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("bad json");
      },
    }));
    await expect(fetchGloss("x", "y")).rejects.toBeInstanceOf(
      GlossUnavailableError
    );
  });

  it("rejects with an abort error when the caller aborts, and caches nothing", async () => {
    let calls = 0;
    const fetchFn = vi.fn((_url: string, init: { signal: AbortSignal }) => {
      calls += 1;
      if (calls === 1) {
        return new Promise<never>((_, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError"))
          );
        });
      }
      return Promise.resolve(okResponse());
    });
    const { fetchGloss } = createGlossClient(fetchFn);
    const controller = new AbortController();
    const pending = fetchGloss("mar", "El mar", controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbortError);
    // The abort cancelled the underlying fetch and cached nothing: an
    // immediate re-request goes back to the network and succeeds.
    const after = await fetchGloss("mar", "El mar");
    expect(after).toEqual(entry);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("rejects immediately on an already-aborted signal without fetching", async () => {
    const fetchFn = vi.fn(async () => okResponse());
    const { fetchGloss } = createGlossClient(fetchFn);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchGloss("mar", "El mar", controller.signal)).rejects.toSatisfy(
      isAbortError
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("does not cancel the shared fetch while another caller still waits", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const seen: AbortSignal[] = [];
    const fetchFn = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
      seen.push(init.signal);
      await gate;
      return okResponse();
    });
    const { fetchGloss } = createGlossClient(fetchFn);
    const first = new AbortController();
    const a = fetchGloss("rio", "El rio", first.signal);
    const second = new AbortController();
    const b = fetchGloss("rio", "El rio", second.signal);
    first.abort();
    await expect(a).rejects.toSatisfy(isAbortError);
    expect(seen[0].aborted).toBe(false);
    release();
    expect(await b).toEqual(entry);
  });
});
