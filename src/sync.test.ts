import { describe, expect, it } from "vitest";
import { PositionTracker, findActiveLine } from "./sync";
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

  it("does not snap back when the follow-up poll agrees with the nudge", () => {
    const t = new PositionTracker();
    t.update(60000, true, 0);
    t.nudge(5000, 1000);
    // At now=1500 interpolated is 5500; poll says 5400 (within threshold)
    t.update(5400, true, 1500);
    expect(t.positionAt(1500)).toBe(5500);
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
