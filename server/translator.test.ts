import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  GeminiProvider,
  TranslationFailedError,
  isRateLimitError,
  parseRetryDelayMs,
  translateLines,
} from "./translator";
import type { TrackMeta, TranslationProvider } from "./types";

const generateContentMock = vi.hoisted(() => vi.fn());

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => ({
    models: {
      generateContent: generateContentMock,
    },
  })),
}));

const meta: TrackMeta = { trackId: "t1", title: "Song", artist: "Artist" };

function mockProvider(
  impl: (lines: string[]) => Promise<string[]>
): TranslationProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    translate: vi.fn(async (lines: string[]) => {
      calls.push(lines);
      return impl(lines);
    }),
  };
}

function rateLimitError(message?: string): Error {
  const err = new Error(
    message ??
      "got status: 429. RESOURCE_EXHAUSTED: Quota exceeded for metric generate_content_free_tier_requests"
  );
  (err as any).status = 429;
  return err;
}

function numbered(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `linea ${i + 1}`);
}

afterEach(() => {
  vi.useRealTimers();
  generateContentMock.mockReset();
});

describe("GeminiProvider", () => {
  it("uses the Flash Lite latest alias by default", async () => {
    generateContentMock.mockResolvedValue({ text: '["hello"]' });

    const provider = new GeminiProvider("api-key");
    await expect(provider.translate(["hola"], meta)).resolves.toEqual([
      "hello",
    ]);

    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: DEFAULT_MODEL,
      })
    );
    expect(DEFAULT_MODEL).toBe("gemini-flash-lite-latest");
  });

  it("surfaces a clear error for an unavailable configured Gemini model", async () => {
    const err = new Error(
      "got status: 404. This model retired-model is no longer available to new users"
    );
    (err as any).status = 404;
    generateContentMock.mockRejectedValue(err);

    const provider = new GeminiProvider("api-key", "retired-model");
    await expect(translateLines(provider, ["hola"], meta)).rejects.toThrow(
      'Gemini model "retired-model" is unavailable. Set GEMINI_MODEL to a supported Gemini model, for example gemini-flash-lite-latest.'
    );
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});

describe("translateLines", () => {
  it("returns the batch result when the count matches", async () => {
    const p = mockProvider(async (lines) => lines.map((l) => `EN:${l}`));
    const out = await translateLines(p, ["hola", "adios"], meta);
    expect(out).toEqual(["EN:hola", "EN:adios"]);
    expect(p.calls).toHaveLength(1);
  });

  it("retries once on a count mismatch, then succeeds", async () => {
    let call = 0;
    const p = mockProvider(async (lines) => {
      call++;
      if (call === 1) return ["only one"];
      return lines.map((l) => `EN:${l}`);
    });
    const out = await translateLines(p, ["hola", "adios"], meta);
    expect(out).toEqual(["EN:hola", "EN:adios"]);
    expect(p.calls).toHaveLength(2);
  });

  it("falls back to chunks of 20 after two bad batches", async () => {
    const lines = numbered(60);
    const p = mockProvider(async (batch) => {
      if (batch.length > 20) return ["wrong count"];
      return batch.map((l) => `EN:${l}`);
    });
    const out = await translateLines(p, lines, meta);
    expect(out).toEqual(lines.map((l) => `EN:${l}`));
    // 2 batch attempts + ceil(60 / 20) chunk requests
    expect(p.calls).toHaveLength(5);
    expect(p.calls.slice(2).map((c) => c.length)).toEqual([20, 20, 20]);
    expect(p.calls[2][0]).toBe("linea 1");
    expect(p.calls[4][19]).toBe("linea 60");
  });

  it("uses one short final chunk when the count is not a multiple", async () => {
    const lines = numbered(45);
    const p = mockProvider(async (batch) => {
      if (batch.length > 20) throw new Error("batch fails");
      return batch.map((l) => `EN:${l}`);
    });
    const out = await translateLines(p, lines, meta);
    expect(out).toEqual(lines.map((l) => `EN:${l}`));
    expect(p.calls.slice(2).map((c) => c.length)).toEqual([20, 20, 5]);
  });

  it("fails the whole translation when a chunk keeps a bad count", async () => {
    const lines = numbered(40);
    const p = mockProvider(async (batch) => {
      if (batch.length > 20) return ["wrong count"];
      if (batch[0] === "linea 21") return ["short"];
      return batch.map((l) => `EN:${l}`);
    });
    await expect(translateLines(p, lines, meta)).rejects.toBeInstanceOf(
      TranslationFailedError
    );
  });

  it("fails the whole translation when a chunk throws, no identity fill", async () => {
    const lines = numbered(40);
    const p = mockProvider(async (batch) => {
      if (batch.length > 20 || batch[0] === "linea 21") {
        throw new Error("provider down");
      }
      return batch.map((l) => `EN:${l}`);
    });
    await expect(translateLines(p, lines, meta)).rejects.toBeInstanceOf(
      TranslationFailedError
    );
  });

  it("waits the suggested retryDelay on 429, then succeeds", async () => {
    vi.useFakeTimers();
    let call = 0;
    const p = mockProvider(async (lines) => {
      call++;
      if (call === 1) {
        throw rateLimitError(
          'got status: 429. {"error":{"details":[{"retryDelay":"7s"}]}}'
        );
      }
      return lines.map((l) => `EN:${l}`);
    });
    const pending = translateLines(p, ["hola", "adios"], meta);
    // The retry must not fire before the suggested delay elapses.
    await vi.advanceTimersByTimeAsync(6999);
    expect(p.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(["EN:hola", "EN:adios"]);
    expect(p.calls).toHaveLength(2);
  });

  it("gives up after bounded 429 retries without falling back", async () => {
    vi.useFakeTimers();
    const p = mockProvider(async () => {
      throw rateLimitError();
    });
    const pending = translateLines(p, ["hola", "adios"], meta);
    const assertion = expect(pending).rejects.toBeInstanceOf(
      TranslationFailedError
    );
    await vi.runAllTimersAsync();
    await assertion;
    // Initial attempt + 2 retries, then a hard stop: no fallback
    // requests that would burn more quota.
    expect(p.calls).toHaveLength(3);
  });

  it("returns an empty result for empty input without calling the provider", async () => {
    const p = mockProvider(async (lines) => lines);
    expect(await translateLines(p, [], meta)).toEqual([]);
    expect(p.calls).toHaveLength(0);
  });
});

describe("isRateLimitError", () => {
  it("detects status, code, and message forms", () => {
    expect(isRateLimitError(rateLimitError())).toBe(true);
    expect(isRateLimitError({ code: 429 })).toBe(true);
    expect(isRateLimitError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isRateLimitError(new Error("got status: 429"))).toBe(true);
    expect(isRateLimitError(new Error("bad JSON"))).toBe(false);
  });
});

describe("parseRetryDelayMs", () => {
  it("reads a RetryInfo retryDelay", () => {
    expect(parseRetryDelayMs(new Error('"retryDelay": "39s"'))).toBe(39000);
  });

  it("reads a prose retry suggestion with fractional seconds", () => {
    expect(parseRetryDelayMs(new Error("Please retry in 7.5s."))).toBe(7500);
  });

  it("caps the delay and rejects garbage", () => {
    expect(parseRetryDelayMs(new Error('"retryDelay": "600s"'))).toBe(60000);
    expect(parseRetryDelayMs(new Error("no delay here"))).toBeNull();
  });
});
