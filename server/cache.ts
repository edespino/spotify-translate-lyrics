import { promises as fs } from "node:fs";
import path from "node:path";
import type { TranslationEntry } from "./types";

// Disk cache for translations, one JSON file per track under
// data/translations/. These files are user data derived from
// copyrighted lyrics and must never be committed.

function safeId(trackId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(trackId)) {
    throw new Error("Invalid track id");
  }
  return trackId;
}

export class TranslationCache {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "translations");
  }

  private filePath(trackId: string): string {
    return path.join(this.dir, `${safeId(trackId)}.json`);
  }

  async read(trackId: string): Promise<TranslationEntry | null> {
    try {
      const raw = await fs.readFile(this.filePath(trackId), "utf8");
      return JSON.parse(raw) as TranslationEntry;
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  async write(entry: TranslationEntry): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.filePath(entry.trackId);
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entry, null, 2), "utf8");
    await fs.rename(tmp, file);
  }

  async setOverride(
    trackId: string,
    lineIndex: number,
    field: "es" | "en",
    text: string
  ): Promise<TranslationEntry> {
    const entry = await this.read(trackId);
    if (!entry || !entry.lines[lineIndex]) {
      throw new Error("Line not found");
    }
    if (field === "es") entry.lines[lineIndex].editedEs = text;
    else entry.lines[lineIndex].editedEn = text;
    await this.write(entry);
    return entry;
  }

  async resetOverride(
    trackId: string,
    lineIndex: number,
    field: "es" | "en"
  ): Promise<TranslationEntry> {
    const entry = await this.read(trackId);
    if (!entry || !entry.lines[lineIndex]) {
      throw new Error("Line not found");
    }
    if (field === "es") delete entry.lines[lineIndex].editedEs;
    else delete entry.lines[lineIndex].editedEn;
    await this.write(entry);
    return entry;
  }

  // Applies fresh translations to an entry. Lines the user has edited
  // (editedEn set) keep their stored en text untouched; the override
  // always wins.
  applyRetranslation(
    entry: TranslationEntry,
    fresh: string[]
  ): TranslationEntry {
    entry.lines.forEach((line, i) => {
      if (line.editedEn === undefined && fresh[i] !== undefined) {
        line.en = fresh[i];
      }
    });
    return entry;
  }
}
