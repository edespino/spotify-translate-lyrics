import { describe, expect, it } from "vitest";
import {
  lrclibSourceUrl,
  lyricsSourceFor,
  overrideSummary,
  overrideToLyricsResult,
  toOverrideMap,
} from "./lyricsOverride";
import type { LyricsOverrideRecord, LyricsOverrideSummary } from "../types";

const summary: LyricsOverrideSummary = {
  trackId: "t1",
  title: "Cancion",
  artist: "Artista",
  kind: "synced",
  lrclibId: 42,
  savedAt: "2026-07-21T00:00:00.000Z",
};

const syncedRecord: LyricsOverrideRecord = {
  ...summary,
  lines: [
    { timeMs: 0, text: "hola" },
    { timeMs: 2000, text: "adios" },
  ],
};

describe("lyricsSourceFor", () => {
  it("routes to the override while one exists, so LRCLIB is never consulted", () => {
    const overrides = toOverrideMap([summary]);
    expect(lyricsSourceFor("t1", overrides)).toBe("override");
  });

  it("routes to lrclib when no override exists", () => {
    expect(lyricsSourceFor("t1", new Map())).toBe("lrclib");
    expect(lyricsSourceFor("other", toOverrideMap([summary]))).toBe("lrclib");
  });
});

describe("toOverrideMap", () => {
  it("keys records by trackId", () => {
    const map = toOverrideMap([summary]);
    expect(map.get("t1")).toEqual(summary);
    expect(map.size).toBe(1);
  });
});

describe("overrideSummary", () => {
  it("strips the lines, keeping everything else", () => {
    expect(overrideSummary(syncedRecord)).toEqual(summary);
  });
});

describe("overrideToLyricsResult", () => {
  it("maps a synced override to a synced result with its lrclibId", () => {
    expect(overrideToLyricsResult(syncedRecord)).toEqual({
      kind: "synced",
      lines: [
        { timeMs: 0, text: "hola" },
        { timeMs: 2000, text: "adios" },
      ],
      lrclibId: 42,
    });
  });

  it("maps a plain override to a plain result of texts", () => {
    const record: LyricsOverrideRecord = {
      ...syncedRecord,
      kind: "plain",
      lines: [
        { timeMs: 0, text: "uno" },
        { timeMs: 0, text: "dos" },
      ],
    };
    expect(overrideToLyricsResult(record)).toEqual({
      kind: "plain",
      lines: ["uno", "dos"],
      lrclibId: 42,
    });
  });

  it("omits lrclibId when the record has none", () => {
    const record: LyricsOverrideRecord = { ...syncedRecord };
    delete record.lrclibId;
    const result = overrideToLyricsResult(record);
    expect("lrclibId" in result).toBe(false);
  });
});

describe("lrclibSourceUrl", () => {
  it("points at the exact API record when the id is known", () => {
    expect(lrclibSourceUrl(4242, "T", "A")).toBe(
      "https://lrclib.net/api/get/4242"
    );
  });

  it("falls back to a search for track and artist", () => {
    expect(
      lrclibSourceUrl(undefined, "La Feria De Las Flores", "Los Lobos")
    ).toBe(
      `https://lrclib.net/search/${encodeURIComponent(
        "La Feria De Las Flores Los Lobos"
      )}`
    );
  });
});
