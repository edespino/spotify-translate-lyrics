import { describe, expect, it } from "vitest";
import {
  LineCountError,
  GlossShapeError,
  parseGlossResponse,
  parseTranslationResponse,
  validateGlossEntry,
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

describe("validateGlossEntry", () => {
  it("accepts the exact gloss object shape", () => {
    expect(
      validateGlossEntry({
        word: "corazon",
        gloss: "heart",
        partOfSpeech: "noun",
        note: "",
      })
    ).toEqual({
      word: "corazon",
      gloss: "heart",
      partOfSpeech: "noun",
      note: "",
    });
  });

  it("rejects non-objects, extra fields, and bad types", () => {
    expect(() => validateGlossEntry([])).toThrow(GlossShapeError);
    expect(() =>
      validateGlossEntry({
        word: "luz",
        gloss: "light",
        partOfSpeech: "noun",
        note: "",
        extra: "no",
      })
    ).toThrow(GlossShapeError);
    expect(() =>
      validateGlossEntry({
        word: "luz",
        gloss: 5,
        partOfSpeech: "noun",
        note: "",
      })
    ).toThrow(GlossShapeError);
  });

  it("rejects unsupported part-of-speech tags and bad gloss lengths", () => {
    expect(() =>
      validateGlossEntry({
        word: "luz",
        gloss: "light",
        partOfSpeech: "article",
        note: "",
      })
    ).toThrow(GlossShapeError);
    expect(() =>
      validateGlossEntry({
        word: "luz",
        gloss: "",
        partOfSpeech: "noun",
        note: "",
      })
    ).toThrow(GlossShapeError);
    expect(() =>
      validateGlossEntry({
        word: "",
        gloss: "light",
        partOfSpeech: "noun",
        note: "",
      })
    ).toThrow(GlossShapeError);
    expect(() =>
      validateGlossEntry({
        word: "luz",
        gloss: "one two three four five six seven",
        partOfSpeech: "noun",
        note: "",
      })
    ).toThrow(GlossShapeError);
  });
});

describe("parseGlossResponse", () => {
  it("parses raw and fenced JSON gloss objects", () => {
    const raw = '{"word":"luz","gloss":"light","partOfSpeech":"noun","note":""}';
    expect(parseGlossResponse(raw).gloss).toBe("light");
    expect(parseGlossResponse(`\`\`\`json\n${raw}\n\`\`\``).word).toBe("luz");
  });

  it("throws GlossShapeError on invalid JSON", () => {
    expect(() => parseGlossResponse("not json")).toThrow(GlossShapeError);
  });
});
