import type { PlaybackState } from "./types";

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string;
const SCOPES = "user-read-currently-playing user-read-playback-state";
const TOKEN_KEY = "spotify_tokens";
const VERIFIER_KEY = "spotify_pkce_verifier";

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

// Exchanges the ?code= from the redirect for tokens. Returns true on success.
export async function handleCallback(code: string): Promise<boolean> {
  const verifier = localStorage.getItem(VERIFIER_KEY);
  if (!verifier) return false;
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

// Returns a valid access token, silently refreshing when expired.
// Throws AuthError when re-auth is required.
export class AuthError extends Error {}

async function getAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new AuthError("Not authenticated");
  if (Date.now() < tokens.expiresAt - 60000) return tokens.accessToken;
  if (!tokens.refreshToken) {
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
    return fresh.accessToken;
  } catch {
    clearTokens();
    throw new AuthError("Token refresh failed");
  }
}

export class RateLimitError extends Error {}

// Polls the currently playing track. Returns null when nothing is playing.
export async function fetchCurrentlyPlaying(): Promise<PlaybackState | null> {
  const token = await getAccessToken();
  const res = await fetch(
    "https://api.spotify.com/v1/me/player/currently-playing",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 204) return null;
  if (res.status === 429) throw new RateLimitError("Rate limited");
  if (res.status === 401) {
    clearTokens();
    throw new AuthError("Unauthorized");
  }
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
