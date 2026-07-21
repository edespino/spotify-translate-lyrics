import { describe, expect, it } from "vitest";
import {
  RECALL_STORAGE_KEY,
  activeReveals,
  enCellMasked,
  isRevealKey,
  loadRecallMode,
  maskGesture,
  nextReveals,
  saveRecallMode,
} from "./recall";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const throwingStorage = {
  getItem: (): string | null => {
    throw new Error("storage disabled");
  },
  setItem: (): void => {
    throw new Error("storage disabled");
  },
};

describe("recall mode persistence", () => {
  it("defaults to off when nothing is stored", () => {
    expect(loadRecallMode(fakeStorage())).toBe(false);
  });

  it("round-trips on through storage", () => {
    const storage = fakeStorage();
    saveRecallMode(true, storage);
    expect(loadRecallMode(storage)).toBe(true);
  });

  it("round-trips off through storage", () => {
    const storage = fakeStorage();
    saveRecallMode(true, storage);
    saveRecallMode(false, storage);
    expect(loadRecallMode(storage)).toBe(false);
  });

  it("ignores unrecognized stored values", () => {
    expect(
      loadRecallMode(fakeStorage({ [RECALL_STORAGE_KEY]: "banana" }))
    ).toBe(false);
  });

  it("falls back to off when the storage read throws", () => {
    expect(loadRecallMode(throwingStorage)).toBe(false);
  });

  it("silently ignores a storage write that throws", () => {
    expect(() => saveRecallMode(true, throwingStorage)).not.toThrow();
  });

  it("treats an unavailable storage as off", () => {
    expect(loadRecallMode(null)).toBe(false);
    expect(() => saveRecallMode(true, null)).not.toThrow();
  });
});

describe("enCellMasked", () => {
  it("masks a translated cell while recall is on and unrevealed", () => {
    expect(enCellMasked(true, "text", false, "hello")).toBe(true);
  });

  it("does not mask when recall is off", () => {
    expect(enCellMasked(false, "text", false, "hello")).toBe(false);
  });

  it("does not mask a revealed line", () => {
    expect(enCellMasked(true, "text", true, "hello")).toBe(false);
  });

  it("never masks the loading skeleton", () => {
    expect(enCellMasked(true, "pending", false, null)).toBe(false);
  });

  it("never masks the translation-error placeholder", () => {
    expect(enCellMasked(true, "error", false, null)).toBe(false);
  });

  it("never masks an empty placeholder line", () => {
    expect(enCellMasked(true, "text", false, "")).toBe(false);
    expect(enCellMasked(true, "text", false, "  ")).toBe(false);
  });
});

describe("reveal set", () => {
  it("nextReveals adds an index without mutating the input", () => {
    const before = new Set([1]);
    const after = nextReveals(before, 4);
    expect([...after].sort()).toEqual([1, 4]);
    expect(before.has(4)).toBe(false);
  });

  it("activeReveals keeps reveals for the same track", () => {
    const reveals = { trackId: "t1", indices: new Set([0, 2]) };
    expect(activeReveals(reveals, "t1")).toBe(reveals.indices);
  });

  it("activeReveals resets when the track changes", () => {
    const reveals = { trackId: "t1", indices: new Set([0, 2]) };
    expect(activeReveals(reveals, "t2").size).toBe(0);
  });

  it("activeReveals is empty before any reveal", () => {
    expect(activeReveals(null, "t1").size).toBe(0);
  });
});

describe("isRevealKey", () => {
  it("matches a bare t", () => {
    expect(isRevealKey("t", false, false, false)).toBe(true);
  });

  it("rejects other keys", () => {
    expect(isRevealKey("r", false, false, false)).toBe(false);
    expect(isRevealKey("T", false, false, false)).toBe(false);
  });

  it("rejects t with a modifier held", () => {
    expect(isRevealKey("t", true, false, false)).toBe(false);
    expect(isRevealKey("t", false, true, false)).toBe(false);
    expect(isRevealKey("t", false, false, true)).toBe(false);
  });
});

// Gesture membership is decided by event.detail (the browser's own
// multi-click counter), never by wall-clock time: a click with detail 1
// is always a fresh gesture, no matter how soon it arrives.
describe("maskGesture", () => {
  it("reveal click alone: first click reveals, is swallowed, and arms the tail", () => {
    expect(maskGesture("masked", "click", 1)).toEqual({
      action: "reveal",
      phase: "tail",
    });
  });

  it("keyboard activation (detail 0) reveals the same way", () => {
    expect(maskGesture("masked", "click", 0)).toEqual({
      action: "reveal",
      phase: "tail",
    });
  });

  it("double-click reveal: the second click of the revealing gesture is swallowed", () => {
    expect(maskGesture("tail", "click", 2)).toEqual({
      action: "swallow",
      phase: "tail",
    });
  });

  it("double-click reveal: the dblclick tail is swallowed and ends the gesture, so no editor opens", () => {
    expect(maskGesture("tail", "dblclick", 2)).toEqual({
      action: "swallow",
      phase: "released",
    });
  });

  it("a later deliberate click (a fresh gesture, detail 1) passes through to enlarge and releases the mask", () => {
    expect(maskGesture("tail", "click", 1)).toEqual({
      action: "pass",
      phase: "released",
    });
  });

  it("a dblclick while still masked is swallowed defensively", () => {
    expect(maskGesture("masked", "dblclick", 2)).toEqual({
      action: "swallow",
      phase: "masked",
    });
  });
});
