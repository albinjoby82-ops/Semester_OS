import { eq } from "drizzle-orm";
import { settings } from "../../../db/schema";
import type { AppContext } from "../index";

/**
 * Google OAuth for a single user.
 *
 * Read-only scopes only: this app never writes to Calendar or Drive in Phase
 * 2. Adding a write scope later is a deliberate decision, not a default.
 *
 * Tokens live in the settings table. They are secrets, so they are never
 * returned by any API route -- `status` reports only whether a connection
 * exists and what it can see.
 */

export const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

const KEY = {
  accessToken: "google.accessToken",
  refreshToken: "google.refreshToken",
  expiresAt: "google.expiresAt",
  scope: "google.scope",
  state: "google.oauthState",
  lastSync: "google.lastSync",
} as const;

/** Refresh this many seconds before actual expiry, to avoid edge failures. */
const EXPIRY_MARGIN_SECONDS = 60;

type Db = AppContext["Variables"]["db"];

async function readSetting(db: Db, key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return row?.value ?? null;
}

async function writeSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    });
}

async function clearSetting(db: Db, key: string): Promise<void> {
  await db.delete(settings).where(eq(settings.key, key));
}

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Read OAuth config from Worker secrets. Returns null when unconfigured, so
 * the UI can explain what is missing instead of throwing.
 */
export function readConfig(env: {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
}): GoogleConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI ?? "",
  };
}

/** Build the consent URL and persist a CSRF state value. */
export async function buildAuthUrl(
  db: Db,
  config: GoogleConfig,
  redirectUri: string,
): Promise<string> {
  const state = crypto.randomUUID();
  await writeSetting(db, KEY.state, state);

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    // offline + consent are required to be issued a refresh token at all.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Verify and consume the CSRF state. Single use. */
export async function consumeState(db: Db, state: string | null): Promise<boolean> {
  const expected = await readSetting(db, KEY.state);
  await clearSetting(db, KEY.state);
  return Boolean(expected) && expected === state;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function storeTokens(db: Db, tokens: TokenResponse): Promise<void> {
  if (tokens.access_token) {
    await writeSetting(db, KEY.accessToken, tokens.access_token);
  }
  // Google only returns a refresh token on first consent. Never overwrite a
  // stored one with nothing, or the connection silently becomes un-refreshable.
  if (tokens.refresh_token) {
    await writeSetting(db, KEY.refreshToken, tokens.refresh_token);
  }
  if (tokens.expires_in) {
    const expiresAt = Date.now() + tokens.expires_in * 1000;
    await writeSetting(db, KEY.expiresAt, String(expiresAt));
  }
  if (tokens.scope) await writeSetting(db, KEY.scope, tokens.scope);
}

export async function exchangeCode(
  db: Db,
  config: GoogleConfig,
  code: string,
  redirectUri: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokens = (await response.json()) as TokenResponse;
  if (!response.ok || tokens.error) {
    return {
      ok: false,
      error: tokens.error_description ?? tokens.error ?? "Token exchange failed",
    };
  }
  if (!tokens.refresh_token) {
    // Without a refresh token the connection dies in an hour. Better to fail
    // loudly here than to appear connected and quietly stop working.
    return {
      ok: false,
      error:
        "Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.",
    };
  }

  await storeTokens(db, tokens);
  return { ok: true };
}

async function refreshAccessToken(
  db: Db,
  config: GoogleConfig,
  refreshToken: string,
): Promise<string | null> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  const tokens = (await response.json()) as TokenResponse;
  if (!response.ok || !tokens.access_token) return null;

  await storeTokens(db, tokens);
  return tokens.access_token;
}

/**
 * A usable access token, refreshing if needed. Null when not connected or
 * when the refresh has stopped working (which is when re-consent is needed).
 */
export async function getAccessToken(
  db: Db,
  config: GoogleConfig,
): Promise<string | null> {
  const [accessToken, refreshToken, expiresAtRaw] = await Promise.all([
    readSetting(db, KEY.accessToken),
    readSetting(db, KEY.refreshToken),
    readSetting(db, KEY.expiresAt),
  ]);

  if (!refreshToken) return null;

  const expiresAt = Number(expiresAtRaw ?? 0);
  const stillValid =
    accessToken && expiresAt > Date.now() + EXPIRY_MARGIN_SECONDS * 1000;

  if (stillValid) return accessToken;
  return refreshAccessToken(db, config, refreshToken);
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  scopes: string[];
  expiresAt: number | null;
  lastSync: string | null;
}

/** Connection status. Deliberately returns no token material. */
export async function getStatus(
  db: Db,
  configured: boolean,
): Promise<GoogleStatus> {
  const [refreshToken, scope, expiresAt, lastSync] = await Promise.all([
    readSetting(db, KEY.refreshToken),
    readSetting(db, KEY.scope),
    readSetting(db, KEY.expiresAt),
    readSetting(db, KEY.lastSync),
  ]);

  return {
    configured,
    connected: Boolean(refreshToken),
    scopes: scope ? scope.split(" ") : [],
    expiresAt: expiresAt ? Number(expiresAt) : null,
    lastSync,
  };
}

export async function recordSync(db: Db): Promise<void> {
  await writeSetting(db, KEY.lastSync, new Date().toISOString());
}

export async function disconnect(db: Db): Promise<void> {
  await Promise.all([
    clearSetting(db, KEY.accessToken),
    clearSetting(db, KEY.refreshToken),
    clearSetting(db, KEY.expiresAt),
    clearSetting(db, KEY.scope),
    clearSetting(db, KEY.state),
  ]);
}

export { KEY as GOOGLE_SETTING_KEYS };
