# spotify-translate-lyrics

Personal web app that shows time-synced Spanish lyrics for whatever is playing on your Spotify account, with a line-aligned English translation next to it. Both panes scroll and highlight like Spotify's own lyrics view. Lyrics come from LRCLIB, translations from the Gemini API, and everything is cached on disk so a song is only translated once. You can edit any line (Spanish or English) and your edits stick, even through a retranslate.

Not affiliated with Spotify in any way. For personal use only.

## Setup

You need Node 20+ and two free accounts.

1. Spotify app. Go to https://developer.spotify.com/dashboard, create an app (development mode is fine, it only needs to work for your own account). Add this redirect URI in the app settings:

   ```
   http://127.0.0.1:5173/callback
   ```

   Copy the client ID.

2. Gemini key. Get an API key at https://aistudio.google.com (free tier is enough).

3. Configure:

   ```
   cp .env.example .env
   ```

   Fill in `VITE_SPOTIFY_CLIENT_ID` and `GEMINI_API_KEY`. `GEMINI_MODEL` is optional; it defaults to `gemini-flash-lite-latest`, an alias that tracks Google's current Flash Lite model. Translation runs in a few batched requests per song and backs off on rate limits, so the free tier is workable.

4. Run:

   ```
   npm install
   npm run dev
   ```

   Open http://127.0.0.1:5173 (use 127.0.0.1, not localhost, so the Spotify redirect matches), click Connect Spotify, and play a Spanish song.
   A second dev server now fails with a port-in-use error instead of silently starting on another port; stop the stray server instead.

## Usage notes

Songs whose lyrics are already English are detected client-side and shown as a single centered pane, read-only, with no translation request made at all.

Double-click any line to edit it, Enter saves, Escape cancels. Edited lines get a small marker and a per-line reset link. "Retranslate all" redoes the translation but never touches lines you edited. Clicking a line enlarges it.

Any synced line can be replayed from its start: click the small replay glyph that appears on the active line (and on hover or focus), press `r` while a line is focused, or press `r` anywhere to replay the current line. Replay seeks Spotify playback, which requires the `user-modify-playback-state` scope: sessions connected before this feature existed must click Connect Spotify once more to grant it. Replay needs an active Spotify device; without one a brief notice appears instead.

Translations and edits live in `data/translations/`, one JSON file per track. That directory is gitignored on purpose: it is derived from copyrighted lyrics and should never be committed.

## Scripts

- `npm run dev` starts the Vite frontend and the translation server together
- `npm test` runs the Vitest suite
- `npm run typecheck` runs tsc
- `npm run lint` runs eslint

## License

Apache 2.0, see LICENSE.
