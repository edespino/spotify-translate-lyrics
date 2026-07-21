import { describe, expect, it } from "vitest";
import type { LyricsState } from "../App";
import { syncBadge } from "./syncStatus";

describe("syncBadge", () => {
  it("labels synced lyrics", () => {
    const lyrics: LyricsState = {
      status: "ready",
      result: { kind: "synced", lines: [{ timeMs: 0, text: "hola" }] },
    };
    const badge = syncBadge(lyrics);
    expect(badge?.label).toBe("Synced");
    expect(badge?.title).toMatch(/follows playback/);
  });

  it("labels plain lyrics with an explanation of the missing timestamps", () => {
    const lyrics: LyricsState = {
      status: "ready",
      result: { kind: "plain", lines: ["hola"] },
    };
    const badge = syncBadge(lyrics);
    expect(badge?.label).toBe("Unsynced");
    expect(badge?.title).toMatch(/LRCLIB/);
    expect(badge?.title).toMatch(/no moving highlight/);
  });

  it("shows nothing while loading so the badge cannot flicker", () => {
    expect(syncBadge({ status: "loading" })).toBeNull();
  });

  it("shows nothing for idle, error, instrumental, and none", () => {
    expect(syncBadge({ status: "idle" })).toBeNull();
    expect(syncBadge({ status: "error" })).toBeNull();
    expect(
      syncBadge({ status: "ready", result: { kind: "instrumental" } })
    ).toBeNull();
    expect(syncBadge({ status: "ready", result: { kind: "none" } })).toBeNull();
  });
});
