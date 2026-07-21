import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashMeetsTarget, solveChallenge } from "./lrclibFlag";

const EASY_TARGET = "ff".repeat(32);
const IMPOSSIBLE_TARGET = "00".repeat(32);

describe("hashMeetsTarget", () => {
  it("accepts any hash under an all-ff target", () => {
    const hash = createHash("sha256").update("anything").digest("hex");
    expect(hashMeetsTarget(hash, EASY_TARGET)).toBe(true);
  });

  it("accepts a hash equal to the target", () => {
    const hash = createHash("sha256").update("x").digest("hex");
    expect(hashMeetsTarget(hash, hash)).toBe(true);
  });

  it("rejects a hash above the target", () => {
    const target = "7f" + "ff".repeat(31);
    expect(hashMeetsTarget("80" + "00".repeat(31), target)).toBe(false);
  });

  it("compares bytewise from the most significant byte", () => {
    const target = "10" + "00".repeat(31);
    // First byte below the target's wins regardless of the rest.
    expect(hashMeetsTarget("0f" + "ff".repeat(31), target)).toBe(true);
    expect(hashMeetsTarget("10" + "00".repeat(30) + "01", target)).toBe(false);
  });

  it("rejects length mismatches and empty hashes", () => {
    expect(hashMeetsTarget("ffff", EASY_TARGET)).toBe(false);
    expect(hashMeetsTarget("", "")).toBe(false);
  });
});

describe("solveChallenge", () => {
  it("solves a trivial target at nonce 0", async () => {
    const nonce = await solveChallenge("prefix", EASY_TARGET);
    expect(nonce).toBe(0);
    const hash = createHash("sha256").update("prefix0").digest("hex");
    expect(hashMeetsTarget(hash, EASY_TARGET)).toBe(true);
  });

  it("finds a verifying nonce on a moderate target", async () => {
    // 4 bits of work on average; small enough for a test, large enough
    // that nonce 0 is unlikely for this fixed prefix.
    const target = "0f" + "ff".repeat(31);
    const nonce = await solveChallenge("abc123", target);
    expect(nonce).not.toBeNull();
    const hash = createHash("sha256")
      .update(`abc123${nonce}`)
      .digest("hex");
    expect(hashMeetsTarget(hash, target)).toBe(true);
  });

  it("gives up when the attempt budget runs out", async () => {
    const nonce = await solveChallenge("prefix", IMPOSSIBLE_TARGET, {
      maxAttempts: 100,
    });
    expect(nonce).toBeNull();
  });

  it("gives up when the time budget runs out", async () => {
    const nonce = await solveChallenge("prefix", IMPOSSIBLE_TARGET, {
      timeBudgetMs: -1,
    });
    expect(nonce).toBeNull();
  });
});
