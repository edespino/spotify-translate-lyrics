import { describe, expect, it } from "vitest";
import {
  enCellState,
  isTypingTarget,
  replayEligible,
  rowClassName,
  rowKeyAction,
  rowPhase,
  scrollBehavior,
} from "./lyricsRow";

describe("rowPhase", () => {
  it("classifies rows around the active index", () => {
    expect(rowPhase(0, 2, true)).toBe("past");
    expect(rowPhase(1, 2, true)).toBe("past");
    expect(rowPhase(2, 2, true)).toBe("active");
    expect(rowPhase(3, 2, true)).toBe("upcoming");
  });

  it("treats everything as upcoming before the first active line", () => {
    expect(rowPhase(0, -1, true)).toBe("upcoming");
    expect(rowPhase(5, -1, true)).toBe("upcoming");
  });

  it("never marks unsynced lyrics past or active", () => {
    expect(rowPhase(0, 2, false)).toBe("upcoming");
    expect(rowPhase(2, 2, false)).toBe("upcoming");
  });
});

describe("rowClassName", () => {
  it("emits the phase and focus classes", () => {
    expect(rowClassName("active", false)).toBe("lyric-row active");
    expect(rowClassName("past", false)).toBe("lyric-row past");
    expect(rowClassName("upcoming", false)).toBe("lyric-row");
    expect(rowClassName("upcoming", true)).toBe("lyric-row focused");
    expect(rowClassName("active", true)).toBe("lyric-row active focused");
  });
});

describe("enCellState", () => {
  it("returns text whenever a translation exists", () => {
    expect(enCellState("hello", "ready")).toBe("text");
    expect(enCellState("", "ready")).toBe("text");
  });

  it("returns pending while a translation may still arrive", () => {
    expect(enCellState(null, "idle")).toBe("pending");
    expect(enCellState(null, "loading")).toBe("pending");
  });

  it("returns error once translation has failed", () => {
    expect(enCellState(null, "error")).toBe("error");
  });
});

describe("rowKeyAction", () => {
  it("maps Enter to toggle and F2 or e to edit", () => {
    expect(rowKeyAction("Enter")).toBe("toggle");
    expect(rowKeyAction("F2")).toBe("edit");
    expect(rowKeyAction("e")).toBe("edit");
  });

  it("maps r to replay", () => {
    expect(rowKeyAction("r")).toBe("replay");
    expect(rowKeyAction("R")).toBeNull();
  });

  it("ignores other keys", () => {
    expect(rowKeyAction("a")).toBeNull();
    expect(rowKeyAction("Escape")).toBeNull();
    expect(rowKeyAction("ArrowDown")).toBeNull();
  });
});

describe("replayEligible", () => {
  it("allows timestamped rows with text", () => {
    expect(replayEligible(0, "hola")).toBe(true);
    expect(replayEligible(12000, "line")).toBe(true);
  });

  it("rejects rows without a timestamp (plain lyrics)", () => {
    expect(replayEligible(null, "hola")).toBe(false);
  });

  it("rejects instrumental placeholder rows (empty text)", () => {
    expect(replayEligible(12000, "")).toBe(false);
    expect(replayEligible(12000, "   ")).toBe(false);
  });
});

describe("isTypingTarget", () => {
  it("guards text controls and contentEditable", () => {
    expect(isTypingTarget("INPUT", false)).toBe(true);
    expect(isTypingTarget("input", false)).toBe(true);
    expect(isTypingTarget("TEXTAREA", false)).toBe(true);
    expect(isTypingTarget("SELECT", false)).toBe(true);
    expect(isTypingTarget("DIV", true)).toBe(true);
  });

  it("passes everything else through", () => {
    expect(isTypingTarget("DIV", false)).toBe(false);
    expect(isTypingTarget("BUTTON", false)).toBe(false);
    expect(isTypingTarget(undefined, false)).toBe(false);
  });
});

describe("scrollBehavior", () => {
  it("scrolls smoothly for nearby targets", () => {
    expect(scrollBehavior(300, 600, false)).toBe("smooth");
    expect(scrollBehavior(-300, 600, false)).toBe("smooth");
  });

  it("snaps when the target is over 1.5 viewport heights away", () => {
    expect(scrollBehavior(901, 600, false)).toBe("auto");
    expect(scrollBehavior(-901, 600, false)).toBe("auto");
  });

  it("always snaps under reduced motion", () => {
    expect(scrollBehavior(10, 600, true)).toBe("auto");
  });
});
