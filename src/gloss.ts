// Client for POST /api/gloss: a concise English gloss of one Spanish
// word as used in a lyric line. Layered on top of the server's disk
// cache: an in-memory cache makes repeat hovers instant within a
// session, and an in-flight map dedupes the fetch when hover jitter
// re-requests a word before the first response lands.

export interface GlossEntry {
  word: string;
  gloss: string;
  partOfSpeech: string;
  note: string;
}

// 400 from the server: the request itself is bad (word not in context,
// malformed). The popover shows nothing for these.
export class GlossInvalidError extends Error {
  constructor() {
    super("Invalid gloss request");
    this.name = "GlossInvalidError";
  }
}

// 502 or network failure: the gloss could not be produced right now.
// The popover shows a brief "no gloss available".
export class GlossUnavailableError extends Error {
  constructor() {
    super("Gloss unavailable");
    this.name = "GlossUnavailableError";
  }
}

// Cache key: the word is case-insensitive (hovering "Amor" and "amor"
// in the same line is the same lookup) and both parts are NFC-normalized
// so composed and decomposed accents collide; the context collapses
// whitespace so trivial spacing differences do not split entries.
export function glossKey(word: string, context: string): string {
  const w = word.normalize("NFC").toLocaleLowerCase("es");
  const c = context.normalize("NFC").replace(/\s+/g, " ").trim();
  return `${w}\u0000${c}`;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

type FetchLike = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface InFlight {
  promise: Promise<GlossEntry>;
  controller: AbortController;
  consumers: number;
}

// Factory so tests inject a fake fetch and get isolated caches; the app
// uses the default instance below.
export function createGlossClient(fetchFn: FetchLike = fetch) {
  const cache = new Map<string, GlossEntry>();
  const inFlight = new Map<string, InFlight>();

  async function request(
    word: string,
    context: string,
    signal: AbortSignal
  ): Promise<GlossEntry> {
    let res;
    try {
      res = await fetchFn("/api/gloss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, context }),
        signal,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw new GlossUnavailableError();
    }
    if (res.status === 400) throw new GlossInvalidError();
    if (!res.ok) throw new GlossUnavailableError();
    try {
      return (await res.json()) as GlossEntry;
    } catch {
      throw new GlossUnavailableError();
    }
  }

  // The underlying fetch has its own controller, aborted only when every
  // caller waiting on it has aborted: a dismissed popover cancels its
  // pending fetch, but never one another caller still wants. The caller
  // sees its own signal's rejection immediately, so a late response can
  // never render.
  function fetchGloss(
    word: string,
    context: string,
    signal?: AbortSignal
  ): Promise<GlossEntry> {
    const key = glossKey(word, context);
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    if (signal?.aborted)
      return Promise.reject(new DOMException("Aborted", "AbortError"));

    let entry = inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const created: InFlight = {
        controller,
        consumers: 0,
        promise: request(word, context, controller.signal).then((gloss) => {
          cache.set(key, gloss);
          return gloss;
        }),
      };
      created.promise
        .finally(() => {
          if (inFlight.get(key) === created) inFlight.delete(key);
        })
        .catch(() => {});
      inFlight.set(key, created);
      entry = created;
    }

    if (!signal) return entry.promise;
    entry.consumers += 1;
    const shared = entry;
    return new Promise<GlossEntry>((resolve, reject) => {
      const onAbort = () => {
        shared.consumers -= 1;
        if (shared.consumers <= 0) {
          shared.controller.abort();
          // Drop the entry now, not in the promise's finally: a hover
          // that re-requests this word right after a dismissal must get
          // a fresh fetch, never the just-aborted one.
          if (inFlight.get(key) === shared) inFlight.delete(key);
        }
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      shared.promise
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  return { fetchGloss };
}

const defaultClient = createGlossClient();

export const fetchGloss = defaultClient.fetchGloss;
