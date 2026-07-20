import { describe, expect, it } from "vitest";
import { parseLrc } from "./lrc";

describe("parseLrc", () => {
  it("parses basic timestamped lines", () => {
    const lines = parseLrc("[00:12.34]Hola mundo\n[00:15.00]Adios");
    expect(lines).toEqual([
      { timeMs: 12340, text: "Hola mundo" },
      { timeMs: 15000, text: "Adios" },
    ]);
  });

  it("handles minutes greater than 9", () => {
    const lines = parseLrc("[10:04.95]Tarde\n[100:00.00]Muy tarde");
    expect(lines[0].timeMs).toBe(10 * 60000 + 4950);
    expect(lines[1].timeMs).toBe(100 * 60000);
  });

  it("handles three digit and one digit fractions", () => {
    expect(parseLrc("[00:01.5]a")[0].timeMs).toBe(1500);
    expect(parseLrc("[00:01.500]a")[0].timeMs).toBe(1500);
    expect(parseLrc("[00:01.050]a")[0].timeMs).toBe(1050);
  });

  it("handles timestamps without fraction", () => {
    expect(parseLrc("[01:30]a")[0].timeMs).toBe(90000);
  });

  it("skips malformed lines and metadata tags", () => {
    const text = [
      "[ar:Artist]",
      "[ti:Title]",
      "not a lyric line",
      "[99:99.99]bad seconds",
      "[00:10.00]good",
      "[0:xx]bad",
    ].join("\n");
    const lines = parseLrc(text);
    expect(lines).toEqual([{ timeMs: 10000, text: "good" }]);
  });

  it("keeps empty text lines", () => {
    const lines = parseLrc("[00:05.00]\n[00:10.00]texto");
    expect(lines).toEqual([
      { timeMs: 5000, text: "" },
      { timeMs: 10000, text: "texto" },
    ]);
  });

  it("expands multiple timestamps on one line and sorts", () => {
    const lines = parseLrc("[00:30.00][00:10.00]coro");
    expect(lines).toEqual([
      { timeMs: 10000, text: "coro" },
      { timeMs: 30000, text: "coro" },
    ]);
  });

  it("tolerates leading whitespace and CRLF", () => {
    const lines = parseLrc("  [00:01.00]a\r\n[00:02.00]b");
    expect(lines).toEqual([
      { timeMs: 1000, text: "a" },
      { timeMs: 2000, text: "b" },
    ]);
  });

  it("returns empty array for empty or garbage input", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("just some text\nmore text")).toEqual([]);
  });
});
