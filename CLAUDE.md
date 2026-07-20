# CLAUDE.md

Context for working on this repo.

## What this is

Personal web app: shows time-synced Spanish lyrics for the currently playing Spotify track with a line-aligned English translation, Spotify-style scrolling. Two processes started by one `npm run dev` (concurrently): a Vite + React + TypeScript frontend and a small Express + TypeScript server run with tsx.

## Layout

- `src/spotify.ts` Spotify OAuth (Authorization Code with PKCE, no client secret, tokens in localStorage, silent refresh). Polls /me/player/currently-playing every 3s, backs off to 10s on 429.
- `src/sync.ts` PositionTracker interpolates playback position between polls with performance.now(); a poll that disagrees with interpolation by more than 1.5s (seek) or a play/pause flip re-anchors. findActiveLine is a binary search over line timestamps.
- `src/lrc.ts` LRC parser: handles minutes over 9, 1 to 3 digit fractions, multiple timestamps per line, skips malformed lines, keeps empty text lines.
- `src/lyrics.ts` LRCLIB client (https://lrclib.net/api/get, CORS is open, called from the browser). Result kinds: synced, plain, instrumental, none.
- `src/App.tsx` state machine: auth, poll loop, per-track lyrics + translation loading, requestAnimationFrame loop for the active line.
- `src/components/LyricsView.tsx` both languages render in ONE scroll container as two-column grid rows, so lines stay vertically aligned by construction; the active row is smooth-scrolled to center. Double-click edits a cell, click enlarges a row.
- `server/app.ts` Express app factory (takes a provider and data dir, which is what the integration tests use).
- `server/translator.ts` provider interface plus the Gemini implementation (@google/genai, model from GEMINI_MODEL, default gemini-2.5-flash-lite, JSON array in and out). translateLines enforces the N-in N-out contract: retry the batch once, then fall back to chunks of 20 lines, each strictly validated. A 429 waits for the provider's suggested retry delay (bounded attempts). Any chunk failure fails the whole translation with TranslationFailedError; the server answers 502 and caches nothing. Original text is never returned as a translation.
- `server/cache.ts` disk cache at data/translations/<trackId>.json. Overrides (editedEs/editedEn) always win; retranslate never overwrites en on a line with editedEn.
- API: POST /api/translate, POST /api/retranslate, POST /api/override, POST /api/override/reset, GET /api/translations/:trackId. Frontend reaches it through the Vite proxy at /api.

## Rules

- `data/` is user data derived from copyrighted lyrics. Never commit it, never weaken the .gitignore entry.
- GEMINI_API_KEY stays server-side only. Never expose it to the browser or prefix it with VITE_.
- Timestamps are never editable, only the text of a line.
- No em dashes or en dashes anywhere in this repo, including docs and commit messages. ASCII punctuation only.
- Commit messages are terse and conventional, no AI attribution of any kind.

## Checks

`npm test`, `npm run typecheck`, `npm run lint` must all pass. Tests are Vitest; server integration tests use supertest with a mocked provider and a temp data dir.
