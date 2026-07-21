import { describe, expect, it } from "vitest";
import { PositionTracker, SETTLE_WINDOW_MS, findActiveLine } from "./sync";
import type { LyricLine } from "./types";

const lines: LyricLine[] = [
  { timeMs: 1000, text: "a" },
  { timeMs: 5000, text: "b" },
  { timeMs: 9000, text: "c" },
];

describe("findActiveLine", () => {
  it("returns -1 before the first line", () => {
    expect(findActiveLine(lines, 0)).toBe(-1);
    expect(findActiveLine(lines, 999)).toBe(-1);
  });

  it("returns the line index exactly at a timestamp", () => {
    expect(findActiveLine(lines, 1000)).toBe(0);
    expect(findActiveLine(lines, 5000)).toBe(1);
    expect(findActiveLine(lines, 9000)).toBe(2);
  });

  it("returns the previous line between timestamps", () => {
    expect(findActiveLine(lines, 4999)).toBe(0);
    expect(findActiveLine(lines, 8999)).toBe(1);
  });

  it("returns the last line past the end", () => {
    expect(findActiveLine(lines, 100000)).toBe(2);
  });

  it("handles an empty list", () => {
    expect(findActiveLine([], 5000)).toBe(-1);
  });

  it("handles a single line", () => {
    const single = [{ timeMs: 3000, text: "x" }];
    expect(findActiveLine(single, 2999)).toBe(-1);
    expect(findActiveLine(single, 3000)).toBe(0);
  });
});

describe("PositionTracker", () => {
  it("interpolates forward while playing", () => {
    const t = new PositionTracker();
    t.update(10000, true, 1000);
    expect(t.positionAt(1000)).toBe(10000);
    expect(t.positionAt(2500)).toBe(11500);
  });

  it("does not advance while paused", () => {
    const t = new PositionTracker();
    t.update(10000, false, 1000);
    expect(t.positionAt(5000)).toBe(10000);
  });

  it("keeps interpolation when a poll agrees within the threshold", () => {
    const t = new PositionTracker();
    t.update(10000, true, 0);
    // At now=3000 interpolated is 13000; poll says 12000 (1s off, under 1.5s)
    t.update(12000, true, 3000);
    expect(t.positionAt(3000)).toBe(13000);
  });

  it("snaps when a poll disagrees by more than the threshold (seek)", () => {
    const t = new PositionTracker();
    t.update(10000, true, 0);
    // At now=3000 interpolated is 13000; poll says 60000 (a seek)
    t.update(60000, true, 3000);
    expect(t.positionAt(3000)).toBe(60000);
    expect(t.positionAt(4000)).toBe(61000);
  });

  it("snaps backward seeks too", () => {
    const t = new PositionTracker();
    t.update(60000, true, 0);
    t.update(5000, true, 1000);
    expect(t.positionAt(1000)).toBe(5000);
  });

  it("snaps on play or pause state change", () => {
    const t = new PositionTracker();
    t.update(10000, true, 0);
    t.update(10500, false, 1000);
    expect(t.positionAt(9999)).toBe(10500);
    t.update(10500, true, 20000);
    expect(t.positionAt(21000)).toBe(11500);
  });

  it("nudge re-anchors immediately at the seek target", () => {
    const t = new PositionTracker();
    t.update(60000, true, 0);
    t.nudge(5000, 1000);
    expect(t.positionAt(1000)).toBe(5000);
    expect(t.positionAt(2000)).toBe(6000);
  });

  it("anchors on a follow-up poll that agrees with the nudge", () => {
    const t = new PositionTracker();
    t.update(60000, true, 0);
    t.nudge(5000, 1000);
    // At now=1500 interpolated is 5500; poll says 5400 (within threshold),
    // confirming the seek: it becomes the anchor and ends the window.
    t.update(5400, true, 1500);
    expect(t.positionAt(1500)).toBe(5400);
    expect(t.positionAt(2500)).toBe(6400);
  });

  it("nudge holds the position while paused", () => {
    const t = new PositionTracker();
    t.update(10000, false, 0);
    t.nudge(2000, 500);
    expect(t.positionAt(9000)).toBe(2000);
  });

  it("nudge provides a position even before any poll", () => {
    const t = new PositionTracker();
    t.nudge(3000, 0);
    expect(t.positionAt(1000)).toBe(3000);
  });

  it("returns 0 before any data and after reset", () => {
    const t = new PositionTracker();
    expect(t.positionAt(123)).toBe(0);
    t.update(5000, true, 0);
    t.reset();
    expect(t.positionAt(1000)).toBe(0);
  });
});

describe("PositionTracker seek settle window", () => {
  it("ignores a stale pre-seek poll right after a nudge", () => {
    const t = new PositionTracker();
    t.update(20000, true, 0);
    t.nudge(60000, 1000);
    // Spotify has not applied the seek yet: the poll still says ~20s.
    t.update(20050, true, 1050);
    expect(t.positionAt(1050)).toBe(60050);
  });

  it("anchors on the first confirming poll and ends the window", () => {
    const t = new PositionTracker();
    t.update(20000, true, 0);
    t.nudge(60000, 1000);
    t.update(20050, true, 1050);
    t.update(60100, true, 1300);
    expect(t.positionAt(1300)).toBe(60100);
    expect(t.positionAt(1400)).toBe(60200);
    // Window over: a later divergent poll (external seek) snaps normally.
    t.update(20000, true, 2000);
    expect(t.positionAt(2000)).toBe(20000);
  });

  it("lets an external seek win once the window expires", () => {
    const t = new PositionTracker();
    t.update(20000, true, 0);
    t.nudge(60000, 1000);
    t.update(20050, true, 1050);
    const after = 1000 + SETTLE_WINDOW_MS;
    t.update(30000, true, after);
    expect(t.positionAt(after)).toBe(30000);
  });

  it("honors a pause during the window without anchoring to the stale poll", () => {
    const t = new PositionTracker();
    t.update(20000, true, 0);
    t.nudge(60000, 1000);
    // Paused, but position still reports the pre-seek region: freeze at
    // the interpolated post-seek position instead.
    t.update(20050, false, 1500);
    expect(t.positionAt(3000)).toBe(60500);
  });

  it("clears the window on reset", () => {
    const t = new PositionTracker();
    t.update(20000, true, 0);
    t.nudge(60000, 1000);
    t.reset();
    t.update(20050, true, 1050);
    expect(t.positionAt(1050)).toBe(20050);
  });
});
