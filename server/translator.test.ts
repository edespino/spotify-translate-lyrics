import { describe, expect, it, vi } from "vitest";
import { translateLines } from "./translator";
import type { TrackMeta, TranslationProvider } from "./types";

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

  it("falls back to line-by-line after two bad batches", async () => {
    let call = 0;
    const p = mockProvider(async (lines) => {
      call++;
      if (call <= 2) return ["wrong", "count", "here"];
      return lines.map((l) => `EN:${l}`);
    });
    const out = await translateLines(p, ["hola", "adios"], meta);
    expect(out).toEqual(["EN:hola", "EN:adios"]);
    // 2 batch attempts + 2 single-line calls
    expect(p.calls).toHaveLength(4);
    expect(p.calls[2]).toEqual(["hola"]);
    expect(p.calls[3]).toEqual(["adios"]);
  });

  it("keeps the original text when a single-line fallback fails", async () => {
    const p = mockProvider(async (lines) => {
      if (lines.length > 1) throw new Error("batch fails");
      if (lines[0] === "adios") throw new Error("line fails");
      return [`EN:${lines[0]}`];
    });
    const out = await translateLines(p, ["hola", "adios"], meta);
    expect(out).toEqual(["EN:hola", "adios"]);
  });

  it("does not call the provider for empty lines in fallback mode", async () => {
    const p = mockProvider(async (lines) => {
      if (lines.length > 1) throw new Error("batch fails");
      return [`EN:${lines[0]}`];
    });
    const out = await translateLines(p, ["hola", "", "adios"], meta);
    expect(out).toEqual(["EN:hola", "", "EN:adios"]);
    const singles = p.calls.filter((c) => c.length === 1);
    expect(singles).toEqual([["hola"], ["adios"]]);
  });
});
