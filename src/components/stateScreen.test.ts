import { describe, expect, it } from "vitest";
import type { LyricsState } from "../App";
import { lyricsEmptyState, skeletonWidth } from "./stateScreen";

describe("lyricsEmptyState", () => {
  it("maps loading to a searching message without retry", () => {
    expect(lyricsEmptyState({ status: "loading" })).toEqual({
      message: "Looking for lyrics...",
      retryable: false,
    });
  });

  it("maps error to a service message with retry", () => {
    expect(lyricsEmptyState({ status: "error" })).toEqual({
      message: "Could not reach the lyrics service.",
      retryable: true,
    });
  });

  it("maps a none result to a not-found message without retry", () => {
    const lyrics: LyricsState = {
      status: "ready",
      result: { kind: "none" },
    };
    expect(lyricsEmptyState(lyrics)).toEqual({
      message: "No lyrics found for this track.",
      retryable: false,
    });
  });

  it("keeps the instrumental identity without retry", () => {
    const lyrics: LyricsState = {
      status: "ready",
      result: { kind: "instrumental" },
    };
    expect(lyricsEmptyState(lyrics)).toEqual({
      message: "Instrumental",
      retryable: false,
    });
  });

  it("returns null for idle and for lyric-bearing results", () => {
    expect(lyricsEmptyState({ status: "idle" })).toBeNull();
    expect(
      lyricsEmptyState({
        status: "ready",
        result: { kind: "synced", lines: [{ timeMs: 0, text: "hola" }] },
      })
    ).toBeNull();
    expect(
      lyricsEmptyState({ status: "ready", result: { kind: "plain", lines: ["hola"] } })
    ).toBeNull();
  });
});

describe("skeletonWidth", () => {
  it("cycles 45, 60, 75 percent by row index", () => {
    expect(skeletonWidth(0)).toBe("45%");
    expect(skeletonWidth(1)).toBe("60%");
    expect(skeletonWidth(2)).toBe("75%");
    expect(skeletonWidth(3)).toBe("45%");
    expect(skeletonWidth(4)).toBe("60%");
  });
});
