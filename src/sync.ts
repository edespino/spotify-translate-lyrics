import type { LyricLine } from "./types";

// Returns the index of the last line whose timestamp is at or before
// progressMs, or -1 if progress is before the first line.
export function findActiveLine(lines: LyricLine[], progressMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= progressMs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

export const SNAP_THRESHOLD_MS = 1500;

// Tracks playback position between polls using a monotonic clock.
// A fresh poll only re-anchors the clock when it disagrees with the
// interpolated position by more than SNAP_THRESHOLD_MS (a seek), or
// when the playing state flips.
export class PositionTracker {
  private anchorProgressMs = 0;
  private anchorClockMs = 0;
  private playing = false;
  private hasData = false;

  update(polledProgressMs: number, isPlaying: boolean, nowMs: number): void {
    const interpolated = this.positionAt(nowMs);
    const stateChanged = isPlaying !== this.playing;
    const drifted = Math.abs(interpolated - polledProgressMs) > SNAP_THRESHOLD_MS;
    if (!this.hasData || stateChanged || drifted) {
      this.anchorProgressMs = polledProgressMs;
      this.anchorClockMs = nowMs;
    }
    this.playing = isPlaying;
    this.hasData = true;
  }

  // Re-anchors at a locally initiated seek's target so the highlight
  // snaps at once instead of waiting for the next poll to cross the
  // drift threshold. The playing flag is untouched; the follow-up poll
  // reconciles it.
  nudge(positionMs: number, nowMs: number): void {
    this.anchorProgressMs = positionMs;
    this.anchorClockMs = nowMs;
    this.hasData = true;
  }

  positionAt(nowMs: number): number {
    if (!this.hasData) return 0;
    if (!this.playing) return this.anchorProgressMs;
    return this.anchorProgressMs + (nowMs - this.anchorClockMs);
  }

  reset(): void {
    this.hasData = false;
    this.anchorProgressMs = 0;
    this.anchorClockMs = 0;
    this.playing = false;
  }
}
