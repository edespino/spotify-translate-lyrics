import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
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
  private mutations = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "translations");
  }

  private filePath(trackId: string): string {
    return path.join(this.dir, `${safeId(trackId)}.json`);
  }

  private async mutate<T>(
    trackId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const id = safeId(trackId);
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(fn);
    const next = run.then(
      () => undefined,
      () => undefined
    );
    this.mutations.set(id, next);
    next
      .finally(() => {
        if (this.mutations.get(id) === next) {
          this.mutations.delete(id);
        }
      })
      .catch(() => {});
    return run;
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
    await this.mutate(entry.trackId, () => this.writeUnlocked(entry));
  }

  private async writeUnlocked(entry: TranslationEntry): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.filePath(entry.trackId);
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(entry, null, 2), "utf8");
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  async setTitleEn(
    trackId: string,
    titleEn: string
  ): Promise<TranslationEntry | null> {
    return this.mutate(trackId, async () => {
      const entry = await this.read(trackId);
      if (!entry) return null;
      if (entry.titleEn !== undefined) return entry;
      entry.titleEn = titleEn;
      await this.writeUnlocked(entry);
      return entry;
    });
  }

  async applyRetranslationAndWrite(
    trackId: string,
    titleEn: string,
    fresh: string[]
  ): Promise<TranslationEntry | null> {
    return this.mutate(trackId, async () => {
      const entry = await this.read(trackId);
      if (!entry) return null;
      entry.titleEn = titleEn;
      this.applyRetranslation(entry, fresh);
      await this.writeUnlocked(entry);
      return entry;
    });
  }

  async setOverride(
    trackId: string,
    lineIndex: number,
    field: "es" | "en",
    text: string
  ): Promise<TranslationEntry> {
    return this.mutate(trackId, async () => {
      const entry = await this.read(trackId);
      if (!entry || !entry.lines[lineIndex]) {
        throw new Error("Line not found");
      }
      if (field === "es") entry.lines[lineIndex].editedEs = text;
      else entry.lines[lineIndex].editedEn = text;
      await this.writeUnlocked(entry);
      return entry;
    });
  }

  async resetOverride(
    trackId: string,
    lineIndex: number,
    field: "es" | "en"
  ): Promise<TranslationEntry> {
    return this.mutate(trackId, async () => {
      const entry = await this.read(trackId);
      if (!entry || !entry.lines[lineIndex]) {
        throw new Error("Line not found");
      }
      if (field === "es") delete entry.lines[lineIndex].editedEs;
      else delete entry.lines[lineIndex].editedEn;
      await this.writeUnlocked(entry);
      return entry;
    });
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
