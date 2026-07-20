import type { LyricLine } from "./types";

const TIMESTAMP_RE = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function fracToMs(frac: string | undefined): number {
  if (!frac) return 0;
  if (frac.length === 1) return Number(frac) * 100;
  if (frac.length === 2) return Number(frac) * 10;
  return Number(frac.slice(0, 3));
}

// Parses LRC text into lines sorted by time. Lines without a valid
// timestamp (metadata tags, garbage) are skipped. A line may carry
// multiple timestamps; it is emitted once per timestamp.
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const line of lrc.split(/\r?\n/)) {
    const raw = line.trimStart();
    TIMESTAMP_RE.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    while ((match = TIMESTAMP_RE.exec(raw)) !== null) {
      if (match.index !== lastEnd) break;
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds >= 60) {
        times.length = 0;
        break;
      }
      times.push(minutes * 60000 + seconds * 1000 + fracToMs(match[3]));
      lastEnd = TIMESTAMP_RE.lastIndex;
    }
    if (times.length === 0) continue;
    const text = raw.slice(lastEnd).trim();
    for (const timeMs of times) {
      out.push({ timeMs, text });
    }
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  return out;
}
