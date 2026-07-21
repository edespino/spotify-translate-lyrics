import { createHash } from "node:crypto";

// Community flagging of a wrong LRCLIB entry. LRCLIB gates writes
// behind a proof of work: request a challenge ({prefix, target}), find
// a nonce whose sha256(prefix + nonce) is bytewise <= target, then POST
// the flag with X-Publish-Token "{prefix}:{nonce}". The solver runs
// server-side with a bounded budget and never retries; a failed report
// is reported once to the user, who can press the button again.

export const LRCLIB_CLIENT =
  "spotify-translate-lyrics (personal lyrics translation app)";

const REPORT_CONTENT =
  "The lyrics on this entry do not match the track (wrong lyrics uploaded).";

// Bytewise comparison: the hash meets the target when, scanning from
// the first byte, it is less than or equal to the target (big-endian
// numeric <=).
export function hashMeetsTarget(hashHex: string, targetHex: string): boolean {
  const hash = Buffer.from(hashHex, "hex");
  const target = Buffer.from(targetHex, "hex");
  if (hash.length === 0 || hash.length !== target.length) return false;
  for (let i = 0; i < hash.length; i++) {
    if (hash[i] > target[i]) return false;
    if (hash[i] < target[i]) return true;
  }
  return true;
}

export interface SolveBudget {
  maxAttempts?: number;
  timeBudgetMs?: number;
}

// Sequential nonce search from 0, bounded by attempts and wall-clock
// time; returns null when the budget runs out. Yields to the event
// loop periodically so a long solve does not starve the server.
export async function solveChallenge(
  prefix: string,
  target: string,
  budget: SolveBudget = {}
): Promise<number | null> {
  const maxAttempts = budget.maxAttempts ?? 5_000_000;
  const timeBudgetMs = budget.timeBudgetMs ?? 10_000;
  const deadline = Date.now() + timeBudgetMs;
  for (let nonce = 0; nonce < maxAttempts; nonce++) {
    if ((nonce & 0xfff) === 0) {
      if (Date.now() > deadline) return null;
      await new Promise((resolve) => setImmediate(resolve));
    }
    const hash = createHash("sha256")
      .update(prefix + String(nonce))
      .digest("hex");
    if (hashMeetsTarget(hash, target)) return nonce;
  }
  return null;
}

// One-shot report: one challenge request, one solve, one flag POST.
// Any failure throws; the caller answers 502 and the user decides
// whether to try again.
export async function reportWrongLyrics(
  baseUrl: string,
  lrclibId: number,
  budget?: SolveBudget
): Promise<void> {
  const challengeRes = await fetch(`${baseUrl}/api/request-challenge`, {
    method: "POST",
    headers: { "Lrclib-Client": LRCLIB_CLIENT },
  });
  if (!challengeRes.ok) {
    throw new Error(`LRCLIB challenge request failed (${challengeRes.status})`);
  }
  const challenge = (await challengeRes.json()) as {
    prefix?: unknown;
    target?: unknown;
  };
  if (
    typeof challenge.prefix !== "string" ||
    challenge.prefix === "" ||
    typeof challenge.target !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(challenge.target)
  ) {
    throw new Error("LRCLIB returned a malformed challenge");
  }
  const nonce = await solveChallenge(challenge.prefix, challenge.target, budget);
  if (nonce === null) {
    throw new Error("Challenge not solved within the time budget");
  }
  const flagRes = await fetch(`${baseUrl}/api/flag`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lrclib-Client": LRCLIB_CLIENT,
      "X-Publish-Token": `${challenge.prefix}:${nonce}`,
    },
    body: JSON.stringify({ trackId: lrclibId, content: REPORT_CONTENT }),
  });
  if (!flagRes.ok) {
    throw new Error(`LRCLIB flag request failed (${flagRes.status})`);
  }
}
