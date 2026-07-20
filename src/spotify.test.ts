import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthError,
  fetchCurrentlyPlaying,
  handleCallback,
} from "./spotify";

const TOKEN_KEY = "spotify_tokens";
const VERIFIER_KEY = "spotify_pkce_verifier";
const STATE_KEY = "spotify_oauth_state";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

function jsonResponse(status: number, body: unknown = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

let storage: ReturnType<typeof makeLocalStorage>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = makeLocalStorage();
  fetchMock = vi.fn();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", {
    location: { origin: "http://127.0.0.1:5173" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function storeTokens(expiresAt: number) {
  storage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: "old-access",
      refreshToken: "refresh-1",
      expiresAt,
    })
  );
}

describe("handleCallback state check", () => {
  beforeEach(() => {
    storage.setItem(VERIFIER_KEY, "verifier");
    storage.setItem(STATE_KEY, "expected-state");
  });

  it("rejects a mismatched state without exchanging the code", async () => {
    expect(await handleCallback("code", "wrong-state")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("rejects a missing state", async () => {
    expect(await handleCallback("code", null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when no state was stored", async () => {
    storage.removeItem(STATE_KEY);
    expect(await handleCallback("code", "expected-state")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges the code when the state matches", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: "acc",
        refresh_token: "ref",
        expires_in: 3600,
      })
    );
    expect(await handleCallback("code", "expected-state")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(storage.getItem(TOKEN_KEY)!);
    expect(stored.accessToken).toBe("acc");
    expect(storage.getItem(STATE_KEY)).toBeNull();
  });
});

describe("401 handling and refresh", () => {
  it("refreshes on 401 and retries instead of logging out", async () => {
    storeTokens(Date.now() + 3600_000);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("accounts.spotify.com")) {
        return jsonResponse(200, {
          access_token: "new-access",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      }
      return jsonResponse(fetchMock.mock.calls.length <= 1 ? 401 : 204);
    });
    expect(await fetchCurrentlyPlaying()).toBeNull();
    const stored = JSON.parse(storage.getItem(TOKEN_KEY)!);
    expect(stored.accessToken).toBe("new-access");
  });

  it("clears tokens and throws AuthError only when the refresh fails", async () => {
    storeTokens(Date.now() + 3600_000);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("accounts.spotify.com")) {
        return jsonResponse(400);
      }
      return jsonResponse(401);
    });
    await expect(fetchCurrentlyPlaying()).rejects.toThrow(AuthError);
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("clears tokens when the retry after refresh still returns 401", async () => {
    storeTokens(Date.now() + 3600_000);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("accounts.spotify.com")) {
        return jsonResponse(200, {
          access_token: "new-access",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      }
      return jsonResponse(401);
    });
    await expect(fetchCurrentlyPlaying()).rejects.toThrow(AuthError);
    expect(storage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("single-flights concurrent refreshes", async () => {
    storeTokens(Date.now() - 1000);
    let tokenCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("accounts.spotify.com")) {
        tokenCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse(200, {
          access_token: "new-access",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      }
      return jsonResponse(204);
    });
    const [a, b] = await Promise.all([
      fetchCurrentlyPlaying(),
      fetchCurrentlyPlaying(),
    ]);
    expect(a).toBeNull();
    expect(b).toBeNull();
    expect(tokenCalls).toBe(1);
  });
});
