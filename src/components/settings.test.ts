import { describe, expect, it } from "vitest";
import {
  ACCENTS,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  PAST_MODES,
  accentColor,
  loadAppearance,
  parseAppearance,
  pastModeClass,
  saveAppearance,
} from "./settings";

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

describe("appearance defaults", () => {
  it("defaults to the green accent with dimmed past lines", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ accent: "green", pastMode: "dim" });
  });

  it("offers white to restore the original active-line look", () => {
    expect(accentColor("white")).toBe("#ffffff");
  });

  it("keeps every accent distinguishable from hover gray and focus green", () => {
    for (const a of ACCENTS) {
      expect(a.color.toLowerCase()).not.toBe("#d6d6d6");
      expect(a.color.toLowerCase()).not.toBe("#1db954");
    }
  });

  it("gives every accent a unique color", () => {
    expect(new Set(ACCENTS.map((a) => a.color)).size).toBe(ACCENTS.length);
  });
});

describe("css hooks", () => {
  it("maps every past mode to its container class", () => {
    expect(PAST_MODES.map((m) => pastModeClass(m.id))).toEqual([
      "past-dim",
      "past-bright",
      "past-neutral",
    ]);
  });

  it("maps every accent id to a color", () => {
    for (const a of ACCENTS) {
      expect(accentColor(a.id)).toBe(a.color);
    }
  });
});

describe("parseAppearance", () => {
  it("returns defaults for a missing value", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it("returns defaults for corrupt JSON", () => {
    expect(parseAppearance("{not json")).toEqual(DEFAULT_APPEARANCE);
  });

  it("returns defaults for a non-object value", () => {
    expect(parseAppearance('"green"')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance("null")).toEqual(DEFAULT_APPEARANCE);
  });

  it("accepts every valid accent and past mode combination", () => {
    for (const a of ACCENTS) {
      for (const m of PAST_MODES) {
        const raw = JSON.stringify({ accent: a.id, pastMode: m.id });
        expect(parseAppearance(raw)).toEqual({
          accent: a.id,
          pastMode: m.id,
        });
      }
    }
  });

  it("falls back per field when one value is unknown", () => {
    expect(
      parseAppearance(JSON.stringify({ accent: "plaid", pastMode: "bright" }))
    ).toEqual({ accent: "green", pastMode: "bright" });
    expect(
      parseAppearance(JSON.stringify({ accent: "sky", pastMode: "sparkly" }))
    ).toEqual({ accent: "sky", pastMode: "dim" });
  });

  it("ignores wrongly typed fields", () => {
    expect(
      parseAppearance(JSON.stringify({ accent: 3, pastMode: ["dim"] }))
    ).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("appearance persistence", () => {
  it("round-trips through storage", () => {
    const storage = fakeStorage();
    saveAppearance({ accent: "amber", pastMode: "neutral" }, storage);
    expect(loadAppearance(storage)).toEqual({
      accent: "amber",
      pastMode: "neutral",
    });
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadAppearance(fakeStorage())).toEqual(DEFAULT_APPEARANCE);
  });

  it("returns defaults for a corrupted stored value", () => {
    expect(
      loadAppearance(fakeStorage({ [APPEARANCE_STORAGE_KEY]: "banana" }))
    ).toEqual(DEFAULT_APPEARANCE);
  });

  it("falls back to defaults when the storage read throws", () => {
    expect(loadAppearance(throwingStorage)).toEqual(DEFAULT_APPEARANCE);
  });

  it("silently ignores a storage write that throws", () => {
    expect(() =>
      saveAppearance(DEFAULT_APPEARANCE, throwingStorage)
    ).not.toThrow();
  });

  it("treats an unavailable storage as defaults", () => {
    expect(loadAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(() => saveAppearance(DEFAULT_APPEARANCE, null)).not.toThrow();
  });
});
