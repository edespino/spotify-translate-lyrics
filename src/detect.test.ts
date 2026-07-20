import { afterEach, describe, expect, it, vi } from "vitest";
import { isEnglishLyrics, lyricsPlainText, shouldTranslate } from "./detect";
import { fetchTranslationIfNeeded } from "./translation";
import type { LyricsResult, PlaybackState } from "./types";

const ENGLISH = [
  "I was walking down the road tonight",
  "And you were waiting by the door",
  "All the things we never got to say",
  "Are written on the kitchen floor",
  "But I know that when the morning comes",
  "You will not be there anymore",
  "So I keep on driving through the rain",
  "Just to see your face once more",
].join("\n");

const SPANISH = [
  "Caminaba por la calle esta noche",
  "Y tu esperabas junto a la puerta",
  "Todas las cosas que nunca dijimos",
  "Siguen escritas en el corazón",
  "Pero yo sé que cuando llegue el día",
  "Ya no vas a estar aquí",
  "Sigo manejando bajo la lluvia",
  "Solo para verte una vez más",
].join("\n");

const SPANGLISH = [
  "Baby I know que tu me quieres",
  "And I want you here conmigo",
  "Dime why you had to leave me",
  "Porque my heart esta contigo",
  "All the noches que te espero",
  "You know que yo no miento",
  "Come back porque te quiero",
  "Mi amor, you are my sueño",
].join("\n");

describe("isEnglishLyrics", () => {
  it("classifies clearly English lyrics as English", () => {
    expect(isEnglishLyrics(ENGLISH)).toBe(true);
  });

  it("classifies clearly Spanish lyrics as not English", () => {
    expect(isEnglishLyrics(SPANISH)).toBe(false);
  });

  it("classifies mixed Spanglish lyrics as not English", () => {
    expect(isEnglishLyrics(SPANGLISH)).toBe(false);
  });

  it("treats very short or empty text as not English", () => {
    expect(isEnglishLyrics("")).toBe(false);
    expect(isEnglishLyrics("yeah yeah yeah")).toBe(false);
  });

  it("treats English text with Spanish accents sprinkled in as not English", () => {
    const accented = ENGLISH.replace("road", "corazón").replace(
      "door",
      "señorita"
    );
    expect(isEnglishLyrics(accented)).toBe(false);
  });
});

describe("shouldTranslate", () => {
  const synced = (text: string): LyricsResult => ({
    kind: "synced",
    lines: text.split("\n").map((t, i) => ({ timeMs: i * 1000, text: t })),
  });

  it("skips translation for English synced lyrics", () => {
    expect(shouldTranslate(synced(ENGLISH))).toBe(false);
  });

  it("translates Spanish synced lyrics", () => {
    expect(shouldTranslate(synced(SPANISH))).toBe(true);
  });

  it("translates uncertain Spanglish lyrics", () => {
    expect(shouldTranslate(synced(SPANGLISH))).toBe(true);
  });

  it("skips translation for English plain lyrics", () => {
    expect(shouldTranslate({ kind: "plain", lines: ENGLISH.split("\n") })).toBe(
      false
    );
  });

  it("never translates instrumental or missing lyrics", () => {
    expect(shouldTranslate({ kind: "instrumental" })).toBe(false);
    expect(shouldTranslate({ kind: "none" })).toBe(false);
  });
});

describe("lyricsPlainText", () => {
  it("joins synced and plain lines, empty otherwise", () => {
    expect(
      lyricsPlainText({
        kind: "synced",
        lines: [
          { timeMs: 0, text: "a" },
          { timeMs: 1, text: "b" },
        ],
      })
    ).toBe("a\nb");
    expect(lyricsPlainText({ kind: "plain", lines: ["a", "b"] })).toBe("a\nb");
    expect(lyricsPlainText({ kind: "instrumental" })).toBe("");
  });
});

describe("fetchTranslationIfNeeded", () => {
  const track: PlaybackState = {
    trackId: "t1",
    title: "Song",
    artist: "Artist",
    album: "Album",
    durationMs: 200000,
    progressMs: 0,
    isPlaying: true,
    albumArtUrl: "",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes no fetch at all for English lyrics", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result: LyricsResult = {
      kind: "synced",
      lines: ENGLISH.split("\n").map((t, i) => ({ timeMs: i * 1000, text: t })),
    };
    await expect(fetchTranslationIfNeeded(track, result)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches cache then translate for Spanish lyrics", async () => {
    const entry = { trackId: "t1", title: "Song", artist: "Artist", lines: [] };
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ status: 404, ok: false })
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: () => Promise.resolve(entry),
      });
    vi.stubGlobal("fetch", fetchSpy);
    const result: LyricsResult = {
      kind: "synced",
      lines: SPANISH.split("\n").map((t, i) => ({ timeMs: i * 1000, text: t })),
    };
    await expect(fetchTranslationIfNeeded(track, result)).resolves.toEqual(
      entry
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toBe("/api/translate");
  });
});
