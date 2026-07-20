import { describe, expect, it } from "vitest";
import {
  LineCountError,
  parseTranslationResponse,
  validateLineCount,
} from "./validate";

describe("validateLineCount", () => {
  it("accepts an array of the right length", () => {
    expect(validateLineCount(["a", "b"], 2)).toEqual(["a", "b"]);
  });

  it("throws LineCountError on a mismatch", () => {
    expect(() => validateLineCount(["a"], 2)).toThrow(LineCountError);
    expect(() => validateLineCount(["a", "b", "c"], 2)).toThrow(LineCountError);
  });

  it("throws on non-arrays", () => {
    expect(() => validateLineCount("a\nb", 2)).toThrow();
    expect(() => validateLineCount({ lines: [] }, 0)).toThrow();
  });

  it("coerces non-string members to strings", () => {
    expect(validateLineCount(["a", 5, null], 3)).toEqual(["a", "5", ""]);
  });
});

describe("parseTranslationResponse", () => {
  it("parses a raw JSON array", () => {
    expect(parseTranslationResponse('["one","two"]', 2)).toEqual([
      "one",
      "two",
    ]);
  });

  it("parses a fenced JSON array", () => {
    const fenced = '```json\n["one","two"]\n```';
    expect(parseTranslationResponse(fenced, 2)).toEqual(["one", "two"]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseTranslationResponse("not json", 1)).toThrow();
  });

  it("throws LineCountError on wrong length", () => {
    expect(() => parseTranslationResponse('["one"]', 2)).toThrow(
      LineCountError
    );
  });
});
