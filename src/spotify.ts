import type { PlaybackState } from "./types";

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;
const SCOPES =
  "user-read-currently-playing user-read-playback-state user-modify-playback-state";
const TOKEN_KEY = "spotify_tokens";
const VERIFIER_KEY = "spotify_pkce_verifier";
const STATE_KEY = "spotify_oauth_state";

function redirectUri(): string {
  return `${window.location.origin}/callback`;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function loadTokens(): StoredTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

function saveTokens(t: StoredTokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return loadTokens() !== null;
}

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function beginLogin(): Promise<void> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(verifierBytes);
  localStorage.setItem(VERIFIER_KEY, verifier);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  localStorage.setItem(STATE_KEY, state);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  const challenge = base64Url(new Uint8Array(digest));
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body: URLSearchParams): Promise<StoredTokens> {
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const data = await res.json();
  const existing = loadTokens();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || existing?.refreshToken || "",
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// Exchanges the ?code= from the redirect for tokens. Returns true on
// success. The returned state must match the one stored before the
// redirect, otherwise the callback is rejected.
export async function handleCallback(
  code: string,
  state: string | null
): Promise<boolean> {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  const expectedState = localStorage.getItem(STATE_KEY);
  localStorage.removeItem(STATE_KEY);
  if (!verifier || !expectedState || !state || state !== expectedState) {
    return false;
  }
  try {
    const tokens = await tokenRequest(
      new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier,
      })
    );
    saveTokens(tokens);
    localStorage.removeItem(VERIFIER_KEY);
    return true;
  } catch {
    return false;
  }
}

export class AuthError extends Error {}

// Single-flight refresh: concurrent callers share one in-flight
// token exchange instead of firing several.
let refreshInFlight: Promise<StoredTokens> | null = null;

function refreshTokens(): Promise<StoredTokens> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const tokens = loadTokens();
      if (!tokens?.refreshToken) {
        clearTokens();
        throw new AuthError("No refresh token");
      }
      try {
        const fresh = await tokenRequest(
          new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: "refresh_token",
            refresh_token: tokens.refreshToken,
          })
        );
        saveTokens(fresh);
        return fresh;
      } catch {
        clearTokens();
        throw new AuthError("Token refresh failed");
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// Returns a valid access token, silently refreshing when expired.
// Throws AuthError when re-auth is required.
async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new AuthError("Not authenticated");
  if (Date.now() < tokens.expiresAt - 60000) return tokens.accessToken;
  return (await refreshTokens()).accessToken;
}

export class RateLimitError extends Error {}

function fetchPlayer(token: string): Promise<Response> {
  return fetch("https://api.spotify.com/v1/me/player/currently-playing", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Polls the currently playing track. Returns null when nothing is
// playing. A 401 triggers one refresh attempt and a retry; tokens are
// only cleared when the refresh itself fails or the retry still 401s.
export async function fetchCurrentlyPlaying(): Promise<PlaybackState | null> {
  const token = await getAccessToken();
  let res = await fetchPlayer(token);
  if (res.status === 401) {
    const fresh = await refreshTokens();
    res = await fetchPlayer(fresh.accessToken);
    if (res.status === 401) {
      clearTokens();
      throw new AuthError("Unauthorized");
    }
  }
  if (res.status === 204) return null;
  if (res.status === 429) throw new RateLimitError("Rate limited");
  if (!res.ok) throw new Error(`Spotify error ${res.status}`);
  const data = await res.json();
  const item = data.item;
  if (!item || data.currently_playing_type !== "track") return null;
  return {
    trackId: item.id,
    title: item.name,
    artist: (item.artists || []).map((a: any) => a.name).join(", "),
    album: item.album?.name || "",
    durationMs: item.duration_ms,
    progressMs: data.progress_ms ?? 0,
    isPlaying: data.is_playing,
    albumArtUrl: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || "",
  };
}

// Thrown when Spotify refuses the seek: 404 means no active device,
// 403 means the account or playback context does not allow seeking.
export class SeekUnavailableError extends Error {}

function putSeek(token: string, positionMs: number): Promise<Response> {
  const params = new URLSearchParams({
    position_ms: String(Math.max(0, Math.round(positionMs))),
  });
  return fetch(`https://api.spotify.com/v1/me/player/seek?${params}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Seeks the active device. Same 401-refresh-and-retry handling as the
// currently-playing poll; 403/404 surface as SeekUnavailableError so the
// UI can show a notice instead of crashing.
export async function seekTo(positionMs: number): Promise<void> {
  const token = await getAccessToken();
  let res = await putSeek(token, positionMs);
  if (res.status === 401) {
    const fresh = await refreshTokens();
    res = await putSeek(fresh.accessToken, positionMs);
    if (res.status === 401) {
      clearTokens();
      throw new AuthError("Unauthorized");
    }
  }
  if (res.status === 403 || res.status === 404) {
    throw new SeekUnavailableError(`Seek unavailable (${res.status})`);
  }
  if (res.status === 429) throw new RateLimitError("Rate limited");
  if (!res.ok) throw new Error(`Spotify error ${res.status}`);
}
