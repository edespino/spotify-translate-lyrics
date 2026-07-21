import { describe, expect, it } from "vitest";
import {
  canMarkWrong,
  MARKED_MESSAGE,
  markedFallbackRecord,
  markRequest,
  reportSpec,
  shouldLoadLyrics,
  toMarkMap,
} from "./markedLyrics";
import type { MarkedTrack } from "../types";

const record = (over: Partial<MarkedTrack> = {}): MarkedTrack => ({
  trackId: "t1",
  title: "Cancion",
  artist: "Artista",
  markedAt: "2026-07-21T00:00:00.000Z",
  lrclibId: 4242,
  ...over,
});

describe("canMarkWrong", () => {
  it("allows marking while synced or plain lyrics show", () => {
    expect(
      canMarkWrong({ status: "ready", result: { kind: "synced", lines: [] } })
    ).toBe(true);
    expect(
      canMarkWrong({ status: "ready", result: { kind: "plain", lines: [] } })
    ).toBe(true);
  });

  it("hides the affordance in every non-lyric state", () => {
    expect(canMarkWrong({ status: "idle" })).toBe(false);
    expect(canMarkWrong({ status: "loading" })).toBe(false);
    expect(canMarkWrong({ status: "error" })).toBe(false);
    expect(
      canMarkWrong({ status: "ready", result: { kind: "none" } })
    ).toBe(false);
    expect(
      canMarkWrong({ status: "ready", result: { kind: "instrumental" } })
    ).toBe(false);
  });
});

describe("reportSpec", () => {
  it("enables reporting when the record has an lrclibId", () => {
    const spec = reportSpec(record(), "idle");
    expect(spec.enabled).toBe(true);
    expect(spec.label).toBe("Report to LRCLIB");
  });

  it("disables reporting without an lrclibId and explains the fix", () => {
    const spec = reportSpec(record({ lrclibId: undefined }), "idle");
    expect(spec.enabled).toBe(false);
    expect(spec.title).toContain("Reset");
  });

  it("disables while pending and after a sent report", () => {
    expect(reportSpec(record(), "pending")).toMatchObject({
      enabled: false,
      label: "Reporting...",
    });
    expect(reportSpec(record(), "sent")).toMatchObject({
      enabled: false,
      label: "Reported",
    });
  });

  it("a missing id wins over the report state", () => {
    const spec = reportSpec(record({ lrclibId: undefined }), "sent");
    expect(spec.enabled).toBe(false);
    expect(spec.label).toBe("Report to LRCLIB");
  });
});

describe("toMarkMap", () => {
  it("keys records by trackId", () => {
    const map = toMarkMap([record(), record({ trackId: "t2" })]);
    expect(map.size).toBe(2);
    expect(map.get("t2")?.trackId).toBe("t2");
    expect(map.has("t3")).toBe(false);
  });

  it("handles an empty list", () => {
    expect(toMarkMap([]).size).toBe(0);
  });
});

describe("markRequest", () => {
  const playback = { trackId: "t1", title: "Cancion", artist: "Artista" };

  it("carries the lrclibId from a synced result", () => {
    expect(
      markRequest(playback, { kind: "synced", lines: [], lrclibId: 7 })
    ).toEqual({ trackId: "t1", title: "Cancion", artist: "Artista", lrclibId: 7 });
  });

  it("carries the lrclibId from a plain result", () => {
    expect(
      markRequest(playback, { kind: "plain", lines: [], lrclibId: 9 }).lrclibId
    ).toBe(9);
  });

  it("omits the lrclibId when the result has none", () => {
    const req = markRequest(playback, { kind: "synced", lines: [] });
    expect("lrclibId" in req).toBe(false);
  });
});

describe("shouldLoadLyrics", () => {
  const marks = toMarkMap([record()]);

  it("never loads any track before the marks list resolves", () => {
    // A marked track playing at boot: playback arrives while marks are
    // still loading. Nothing may fetch, marked or not.
    expect(shouldLoadLyrics("t1", false, new Map(), null)).toBe(false);
    expect(shouldLoadLyrics("t9", false, new Map(), null)).toBe(false);
  });

  it("skips marked tracks once ready", () => {
    expect(shouldLoadLyrics("t1", true, marks, null)).toBe(false);
  });

  it("loads an unmarked track exactly once", () => {
    expect(shouldLoadLyrics("t9", true, marks, null)).toBe(true);
    expect(shouldLoadLyrics("t9", true, marks, "t9")).toBe(false);
  });

  it("does nothing without a track", () => {
    expect(shouldLoadLyrics(null, true, new Map(), null)).toBe(false);
  });
});

describe("markedFallbackRecord", () => {
  it("builds a suppressing record without an lrclibId", () => {
    const rec = markedFallbackRecord({
      trackId: "t1",
      title: "Cancion",
      artist: "Artista",
    });
    expect(rec.trackId).toBe("t1");
    expect(rec.title).toBe("Cancion");
    expect(rec.artist).toBe("Artista");
    expect(typeof rec.markedAt).toBe("string");
    expect(rec.lrclibId).toBeUndefined();
  });
});

describe("MARKED_MESSAGE", () => {
  it("names the marked state", () => {
    expect(MARKED_MESSAGE).toContain("marked as incorrect");
  });
});
