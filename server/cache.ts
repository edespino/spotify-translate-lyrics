import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  GlossEntry,
  TranslationEntry,
  VocabEntry,
  VocabInput,
} from "./types";

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

export function normalizeGlossText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

export function glossCacheKey(word: string, context: string): string {
  return createHash("sha1")
    .update(
      JSON.stringify([normalizeGlossText(word), normalizeGlossText(context)])
    )
    .digest("hex");
}

// Saved vocabulary: one JSON array at data/vocab.json. Same user-data
// rules as the translation cache (derived from copyrighted lyrics,
// never committed). All mutations run through one queue (the store is
// a single file, so a single shared key) with tmp-then-rename writes.
export class VocabStore {
  private dir: string;
  private file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dir = dataDir;
    this.file = path.join(dataDir, "vocab.json");
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => {}).then(fn);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  // Entries are stored newest first (add prepends), so list is the
  // response order as-is.
  async list(): Promise<VocabEntry[]> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return JSON.parse(raw) as VocabEntry[];
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  async add(
    input: VocabInput
  ): Promise<{ entry: VocabEntry; duplicate: boolean }> {
    return this.mutate(async () => {
      const entries = await this.list();
      const id = glossCacheKey(input.word, input.contextLine);
      const at = entries.findIndex((e) => e.id === id);
      if (at !== -1) {
        // Duplicate saves update in place: fresh gloss/note/track data
        // replaces the stored fields, keeping the id, savedAt, and list
        // position.
        const entry: VocabEntry = { ...entries[at], ...input, id };
        const next = [...entries];
        next[at] = entry;
        await this.writeUnlocked(next);
        return { entry, duplicate: true };
      }
      const entry: VocabEntry = {
        id,
        ...input,
        savedAt: new Date().toISOString(),
      };
      await this.writeUnlocked([entry, ...entries]);
      return { entry, duplicate: false };
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.mutate(async () => {
      const entries = await this.list();
      const next = entries.filter((e) => e.id !== id);
      if (next.length === entries.length) return false;
      await this.writeUnlocked(next);
      return true;
    });
  }

  private async writeUnlocked(entries: VocabEntry[]): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(entries, null, 2), "utf8");
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }
}

export class GlossCache {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "glosses");
  }

  private filePath(key: string): string {
    return path.join(this.dir, `${key}.json`);
  }

  async read(key: string): Promise<GlossEntry | null> {
    try {
      const raw = await fs.readFile(this.filePath(key), "utf8");
      return JSON.parse(raw) as GlossEntry;
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  async write(key: string, entry: GlossEntry): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.filePath(key);
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(entry, null, 2), "utf8");
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }
}
