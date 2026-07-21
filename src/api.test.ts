import { afterEach, describe, expect, it, vi } from "vitest";
import { requestTranslation, TrackMarkedError } from "./api";

// The 409 from /api/translate (track marked wrong) must surface as its
// own error type so App suppresses the lyrics instead of rendering the
// translation-error state.

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status }))
  );
}

describe("requestTranslation", () => {
  it("surfaces a 409 as TrackMarkedError", async () => {
    stubFetch(409);
    await expect(
      requestTranslation("t1", "T", "A", ["hola"], [0])
    ).rejects.toBeInstanceOf(TrackMarkedError);
  });

  it("keeps other failures as generic server errors", async () => {
    stubFetch(502);
    const failure = requestTranslation("t1", "T", "A", ["hola"], [0]);
    await expect(failure).rejects.toThrow("Server error 502");
    await expect(failure).rejects.not.toBeInstanceOf(TrackMarkedError);
  });
});
