import { describe, expect, it } from "vitest";
import type { GlossEntry } from "../gloss";
import {
  glossEligible,
  glossPopoverNext,
  glossPopoverPosition,
  isGlossClick,
  segmentLine,
  segmentLineFallback,
  type GlossPopoverState,
  type LineToken,
} from "./gloss";

const entry: GlossEntry = {
  word: "amor",
  gloss: "love",
  partOfSpeech: "noun",
  note: "",
};

function joined(tokens: LineToken[]): string {
  return tokens.map((t) => t.text).join("");
}

function words(tokens: LineToken[]): string[] {
  return tokens.filter((t) => t.isWord).map((t) => t.text);
}

// Both the Intl.Segmenter path and the regex fallback must satisfy the
// same contract: tokens concatenate back to the exact input, and word
// tokens keep accents and the n-tilde intact.
const segmenters: [string, (line: string) => LineToken[]][] = [
  ["segmentLine", (line) => segmentLine(line)],
  ["segmentLineFallback", segmentLineFallback],
  ["segmentLine without Segmenter", (line) => segmentLine(line, null)],
];

describe.each(segmenters)("%s", (_name, segment) => {
  it("round-trips the exact input text", () => {
    const line = "¡Ay, corazón!  No te vayas...";
    expect(joined(segment(line))).toBe(line);
  });

  it("keeps accented characters inside their word", () => {
    expect(words(segment("mi corazón después"))).toEqual([
      "mi",
      "corazón",
      "después",
    ]);
  });

  it("keeps the n-tilde inside its word", () => {
    expect(words(segment("el niño sueña"))).toEqual([
      "el",
      "niño",
      "sueña",
    ]);
  });

  it("keeps decomposed accents inside their word", () => {
    expect(words(segment("corazo\u0301n mi\u0301o"))).toEqual([
      "corazo\u0301n",
      "mi\u0301o",
    ]);
  });

  it("excludes punctuation from word tokens", () => {
    const tokens = segment("¿Dónde estás? ¡Ven!");
    expect(words(tokens)).toEqual(["Dónde", "estás", "Ven"]);
    for (const t of tokens) {
      if (!t.isWord) expect(t.text).not.toMatch(/[\p{L}\p{N}]/u);
    }
  });

  it("preserves multiple spaces exactly", () => {
    const line = "uno   dos  tres";
    expect(joined(segment(line))).toBe(line);
    expect(words(segment(line))).toEqual(["uno", "dos", "tres"]);
  });

  it("handles an empty line", () => {
    expect(segment("")).toEqual([]);
  });

  it("handles a line with no words", () => {
    const tokens = segment("... ---");
    expect(joined(tokens)).toBe("... ---");
    expect(words(tokens)).toEqual([]);
  });
});

describe("glossEligible", () => {
  it("allows Spanish cells with text in dual-pane mode", () => {
    expect(glossEligible(false, "es", false, "hola mundo")).toBe(true);
  });

  it("rejects English cells", () => {
    expect(glossEligible(false, "en", false, "hello world")).toBe(false);
  });

  it("rejects English single-pane mode", () => {
    expect(glossEligible(true, "es", false, "hola")).toBe(false);
  });

  it("rejects a cell being edited", () => {
    expect(glossEligible(false, "es", true, "hola")).toBe(false);
  });

  it("rejects empty and whitespace-only lines", () => {
    expect(glossEligible(false, "es", false, "")).toBe(false);
    expect(glossEligible(false, "es", false, "   ")).toBe(false);
  });
});

describe("isGlossClick", () => {
  it("accepts a plain alt-click", () => {
    expect(isGlossClick(true, false, false)).toBe(true);
  });

  it("rejects a plain click", () => {
    expect(isGlossClick(false, false, false)).toBe(false);
  });

  it("rejects alt chords with meta or ctrl", () => {
    expect(isGlossClick(true, true, false)).toBe(false);
    expect(isGlossClick(true, false, true)).toBe(false);
  });
});

describe("glossPopoverNext", () => {
  const loading: GlossPopoverState = {
    status: "loading",
    word: "amor",
    context: "un amor asi",
  };

  it("open always replaces the current state", () => {
    expect(glossPopoverNext(null, { type: "open", word: "a", context: "b" }))
      .toEqual({ status: "loading", word: "a", context: "b" });
    expect(
      glossPopoverNext(loading, { type: "open", word: "sol", context: "el sol" })
    ).toEqual({ status: "loading", word: "sol", context: "el sol" });
  });

  it("loaded moves a matching loading state to ready", () => {
    expect(
      glossPopoverNext(loading, {
        type: "loaded",
        word: "amor",
        context: "un amor asi",
        entry,
      })
    ).toEqual({ status: "ready", word: "amor", context: "un amor asi", entry });
  });

  it("a late loaded for another word never renders", () => {
    expect(
      glossPopoverNext(loading, {
        type: "loaded",
        word: "sol",
        context: "el sol",
        entry,
      })
    ).toBe(loading);
  });

  it("a late loaded after dismissal never renders", () => {
    expect(
      glossPopoverNext(null, {
        type: "loaded",
        word: "amor",
        context: "un amor asi",
        entry,
      })
    ).toBeNull();
  });

  it("failed moves a matching loading state to error", () => {
    expect(
      glossPopoverNext(loading, {
        type: "failed",
        word: "amor",
        context: "un amor asi",
      })
    ).toEqual({ status: "error", word: "amor", context: "un amor asi" });
  });

  it("a mismatched failure is ignored", () => {
    expect(
      glossPopoverNext(loading, { type: "failed", word: "sol", context: "x" })
    ).toBe(loading);
  });

  it("invalid dismisses a matching loading state", () => {
    expect(
      glossPopoverNext(loading, {
        type: "invalid",
        word: "amor",
        context: "un amor asi",
      })
    ).toBeNull();
  });

  it("results never overwrite an already-ready popover", () => {
    const ready: GlossPopoverState = {
      status: "ready",
      word: "amor",
      context: "un amor asi",
      entry,
    };
    expect(
      glossPopoverNext(ready, {
        type: "failed",
        word: "amor",
        context: "un amor asi",
      })
    ).toBe(ready);
  });

  it("dismiss clears any state", () => {
    expect(glossPopoverNext(loading, { type: "dismiss" })).toBeNull();
    expect(glossPopoverNext(null, { type: "dismiss" })).toBeNull();
  });
});

describe("glossPopoverPosition", () => {
  const size = { width: 200, height: 80 };
  const view = { scrollTop: 1000, clientWidth: 800, clientHeight: 600 };

  it("sits below the word at the anchor left", () => {
    const anchor = { left: 100, top: 1200, bottom: 1230 };
    expect(glossPopoverPosition(anchor, size, view)).toEqual({
      left: 100,
      top: 1236,
    });
  });

  it("clamps to the left edge", () => {
    const anchor = { left: 2, top: 1200, bottom: 1230 };
    expect(glossPopoverPosition(anchor, size, view).left).toBe(8);
  });

  it("clamps to the right edge", () => {
    const anchor = { left: 700, top: 1200, bottom: 1230 };
    expect(glossPopoverPosition(anchor, size, view).left).toBe(800 - 200 - 8);
  });

  it("flips above the word when the visible bottom is too close", () => {
    const anchor = { left: 100, top: 1540, bottom: 1570 };
    const pos = glossPopoverPosition(anchor, size, view);
    expect(pos.top).toBe(1540 - 80 - 6);
  });
});
