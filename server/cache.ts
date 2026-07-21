import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type {
  GlossEntry,
  LyricsOverrideRecord,
  LyricsOverrideSummary,
  MarkedTrack,
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

  // Conditional write for the translate path: the skip check runs
  // inside the same per-track queue turn as the write, so a mark whose
  // remove() is already queued cannot have its delete undone by a
  // translation that finished mid-mark. Returns whether it wrote.
  async writeUnless(
    entry: TranslationEntry,
    skip: () => Promise<boolean>
  ): Promise<boolean> {
    return this.mutate(entry.trackId, async () => {
      if (await skip()) return false;
      await this.writeUnlocked(entry);
      return true;
    });
  }

  // Deletes the cached translation for a track (used when its lyrics
  // are marked wrong, so a later reset re-translates fresh). A missing
  // file is not an error.
  async remove(trackId: string): Promise<void> {
    await this.mutate(trackId, async () => {
      try {
        await fs.unlink(this.filePath(trackId));
      } catch (err: any) {
        if (err?.code !== "ENOENT") throw err;
      }
    });
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

// Tracks whose LRCLIB lyrics the user marked wrong: one JSON array at
// data/marked.json. Same pattern as VocabStore: a single file, so all
// mutations run through one queue with tmp-then-rename writes.
export class MarkStore {
  private dir: string;
  private file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dir = dataDir;
    this.file = path.join(dataDir, "marked.json");
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.catch(() => {}).then(fn);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async list(): Promise<MarkedTrack[]> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return JSON.parse(raw) as MarkedTrack[];
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  async get(trackId: string): Promise<MarkedTrack | null> {
    const entries = await this.list();
    return entries.find((e) => e.trackId === trackId) ?? null;
  }

  // Marking an already-marked track updates the record in place (fresh
  // title/artist/lrclibId) and keeps the original markedAt.
  async mark(input: Omit<MarkedTrack, "markedAt">): Promise<MarkedTrack> {
    return this.mutate(async () => {
      const entries = await this.list();
      const at = entries.findIndex((e) => e.trackId === input.trackId);
      const entry: MarkedTrack = {
        ...input,
        markedAt: at === -1 ? new Date().toISOString() : entries[at].markedAt,
      };
      const next = [...entries];
      if (at === -1) next.push(entry);
      else next[at] = entry;
      await this.writeUnlocked(next);
      return entry;
    });
  }

  async reset(trackId: string): Promise<boolean> {
    return this.mutate(async () => {
      const entries = await this.list();
      const next = entries.filter((e) => e.trackId !== trackId);
      if (next.length === entries.length) return false;
      await this.writeUnlocked(next);
      return true;
    });
  }

  private async writeUnlocked(entries: MarkedTrack[]): Promise<void> {
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

// User-corrected lyric sources: one JSON file per track under
// data/lyricsOverrides/, mirroring TranslationCache (override bodies are
// full lyric texts with a per-track lifecycle; a single array file would
// rewrite every track's lyrics on each save). Same per-track mutation
// queue and tmp-then-rename writes. Same user-data rules: derived from
// copyrighted lyrics, never committed.
export class LyricsOverrideStore {
  private dir: string;
  private mutations = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, "lyricsOverrides");
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

  async read(trackId: string): Promise<LyricsOverrideRecord | null> {
    try {
      const raw = await fs.readFile(this.filePath(trackId), "utf8");
      return JSON.parse(raw) as LyricsOverrideRecord;
    } catch (err: any) {
      if (err?.code === "ENOENT") return null;
      throw err;
    }
  }

  async list(): Promise<LyricsOverrideSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
    const out: LyricsOverrideSummary[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const record = await this.read(name.slice(0, -5)).catch(() => null);
      if (!record) continue;
      out.push({
        trackId: record.trackId,
        title: record.title,
        artist: record.artist,
        kind: record.kind,
        ...(typeof record.lrclibId === "number"
          ? { lrclibId: record.lrclibId }
          : {}),
        savedAt: record.savedAt,
      });
    }
    return out;
  }

  // savedAt is always freshly stamped: the translate path uses it to
  // detect an override saved while the provider was running, so a
  // re-save must never look identical to the record it replaced.
  async save(
    input: Omit<LyricsOverrideRecord, "savedAt">
  ): Promise<LyricsOverrideRecord> {
    return this.mutate(input.trackId, async () => {
      const record: LyricsOverrideRecord = {
        ...input,
        savedAt: new Date().toISOString(),
      };
      await this.writeUnlocked(record);
      return record;
    });
  }

  async remove(trackId: string): Promise<boolean> {
    return this.mutate(trackId, async () => {
      try {
        await fs.unlink(this.filePath(trackId));
        return true;
      } catch (err: any) {
        if (err?.code === "ENOENT") return false;
        throw err;
      }
    });
  }

  private async writeUnlocked(record: LyricsOverrideRecord): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const file = this.filePath(record.trackId);
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
      await fs.rename(tmp, file);
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
