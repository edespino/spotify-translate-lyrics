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

  it("rejects arrays containing numbers", () => {
    expect(() => validateLineCount(["a", 5, "c"], 3)).toThrow(
      /non-string/
    );
  });

  it("rejects arrays containing null", () => {
    expect(() => validateLineCount(["a", null, "c"], 3)).toThrow(
      /non-string/
    );
  });

  it("rejects arrays containing objects", () => {
    expect(() => validateLineCount(["a", { text: "b" }, "c"], 3)).toThrow(
      /non-string/
    );
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

  it("rejects a JSON array with non-string members", () => {
    expect(() => parseTranslationResponse('["one", 2]', 2)).toThrow(
      /non-string/
    );
  });
});
