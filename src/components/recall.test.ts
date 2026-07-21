import { describe, expect, it } from "vitest";
import {
  RECALL_STORAGE_KEY,
  activeReveals,
  enCellMasked,
  isRevealKey,
  loadRecallMode,
  nextReveals,
  saveRecallMode,
  suppressAfterReveal,
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

describe("recall mode persistence", () => {
  it("defaults to off when nothing is stored", () => {
    expect(loadRecallMode(fakeStorage())).toBe(false);
  });

  it("round-trips on through storage", () => {
    const storage = fakeStorage();
    saveRecallMode(storage, true);
    expect(loadRecallMode(storage)).toBe(true);
  });

  it("round-trips off through storage", () => {
    const storage = fakeStorage();
    saveRecallMode(storage, true);
    saveRecallMode(storage, false);
    expect(loadRecallMode(storage)).toBe(false);
  });

  it("ignores unrecognized stored values", () => {
    expect(
      loadRecallMode(fakeStorage({ [RECALL_STORAGE_KEY]: "banana" }))
    ).toBe(false);
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

describe("suppressAfterReveal", () => {
  it("suppresses a follow-up gesture on the just-revealed line", () => {
    expect(suppressAfterReveal({ index: 3, time: 1000 }, 3, 1200)).toBe(true);
  });

  it("does not suppress after the double-click window passes", () => {
    expect(suppressAfterReveal({ index: 3, time: 1000 }, 3, 1700)).toBe(false);
  });

  it("does not suppress gestures on other lines", () => {
    expect(suppressAfterReveal({ index: 3, time: 1000 }, 4, 1200)).toBe(false);
  });

  it("does not suppress when nothing was revealed", () => {
    expect(suppressAfterReveal(null, 3, 1200)).toBe(false);
  });
});
