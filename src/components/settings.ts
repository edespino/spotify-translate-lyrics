// Pure logic for appearance settings: the active-line accent color, the
// past-line treatment, and their localStorage round trip. Split out of
// the components so defaults, validation of persisted values, and the
// CSS hook mapping are testable without a DOM.

export const APPEARANCE_STORAGE_KEY = "appearance";

// Curated accent choices for the active line. Every color must stay
// distinguishable from the hover gray (#d6d6d6) and from the
// enlarge/focus green (var(--accent), #1db954): the default green is a
// lighter shade of the same family for exactly that reason, and "white"
// restores the original plain-white active line.
export const ACCENTS = [
  { id: "green", label: "Green", color: "#4ade80" },
  { id: "amber", label: "Amber", color: "#fbbf24" },
  { id: "sky", label: "Sky blue", color: "#38bdf8" },
  { id: "magenta", label: "Magenta", color: "#e879f9" },
  { id: "white", label: "White", color: "#ffffff" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

// Past-line treatments. "dim" renders past lines darker than upcoming
// ones, "bright" is the original behavior (past brighter than upcoming),
// "neutral" makes past match upcoming.
export const PAST_MODES = [
  { id: "dim", label: "Dim" },
  { id: "bright", label: "Bright" },
  { id: "neutral", label: "Neutral" },
] as const;

export type PastModeId = (typeof PAST_MODES)[number]["id"];

export interface AppearanceSettings {
  accent: AccentId;
  pastMode: PastModeId;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  accent: "green",
  pastMode: "dim",
};

export function accentColor(id: AccentId): string {
  return ACCENTS.find((a) => a.id === id)?.color ?? "#ffffff";
}

// The past mode reaches CSS as a class on the lyrics container; each
// class only sets the --past-color custom property, so the selector
// structure underneath stays untouched.
export function pastModeClass(mode: PastModeId): string {
  return `past-${mode}`;
}

interface StorageReader {
  getItem(key: string): string | null;
}

interface StorageWriter {
  setItem(key: string, value: string): void;
}

// localStorage can be entirely unavailable (storage disabled, some
// private modes): even reading window.localStorage throws a
// SecurityError there, so the default is resolved lazily inside a
// try/catch rather than at the call site.
function defaultStorage(): (StorageReader & StorageWriter) | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const ACCENT_IDS = new Set<string>(ACCENTS.map((a) => a.id));
const PAST_MODE_IDS = new Set<string>(PAST_MODES.map((m) => m.id));

// Validation is per field: a stored value that is not valid JSON, not an
// object, or holds an unknown accent or past mode falls back to the
// default for that field only, so one bad field never discards the
// other.
export function parseAppearance(raw: string | null): AppearanceSettings {
  if (raw === null) return DEFAULT_APPEARANCE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_APPEARANCE;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return DEFAULT_APPEARANCE;
  }
  const candidate = parsed as Record<string, unknown>;
  return {
    accent:
      typeof candidate.accent === "string" && ACCENT_IDS.has(candidate.accent)
        ? (candidate.accent as AccentId)
        : DEFAULT_APPEARANCE.accent,
    pastMode:
      typeof candidate.pastMode === "string" &&
      PAST_MODE_IDS.has(candidate.pastMode)
        ? (candidate.pastMode as PastModeId)
        : DEFAULT_APPEARANCE.pastMode,
  };
}

export function loadAppearance(
  storage: StorageReader | null = defaultStorage()
): AppearanceSettings {
  try {
    return parseAppearance(storage?.getItem(APPEARANCE_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

// Persistence is best-effort: a write failure only costs the preference
// surviving a reload, never the session.
export function saveAppearance(
  settings: AppearanceSettings,
  storage: StorageWriter | null = defaultStorage()
): void {
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignored: the settings still apply for this session.
  }
}
