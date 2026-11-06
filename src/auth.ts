import * as fs from "fs";
import { JWT, OAuth2Client } from "google-auth-library";

/**
 * The only scope this server ever requests: read-only Google Analytics.
 */
export const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

function parseServiceAccountKey(raw: string): {
  client_email: string;
  private_key: string;
} | null {
  const tryParse = (s: string) => {
    try {
      const data = JSON.parse(s);
      if (data.client_email && data.private_key) return data;
    } catch {
      // not JSON
    }
    return null;
  };
  // Accept raw JSON or base64-encoded JSON (easier to store in some hosts)
  return (
    tryParse(raw) || tryParse(Buffer.from(raw, "base64").toString("utf-8"))
  );
}

/**
 * Build an authenticated Google client purely from environment variables.
 * Nothing is ever written to disk.
 *
 * Supported configurations, in order of precedence:
 *   1. Service account:
 *      GOOGLE_SERVICE_ACCOUNT_KEY      full key JSON (or base64 of it)
 *      GOOGLE_SERVICE_ACCOUNT_KEY_FILE path to the key JSON file
 *      (add the service account's email as a Viewer on your GA4 properties)
 *   2. OAuth client + refresh token:
 *      GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *
 * Throws if a service account key is configured but unreadable or invalid.
 * Returns null if neither configuration is present.
 */
export function getAuthFromEnv(): OAuth2Client | null {
  let keyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyRaw && process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    try {
      keyRaw = fs.readFileSync(
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE,
        "utf-8"
      );
    } catch {
      throw new Error(
        `Could not read GOOGLE_SERVICE_ACCOUNT_KEY_FILE: ${process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE}`
      );
    }
  }
  if (keyRaw) {
    const key = parseServiceAccountKey(keyRaw);
    if (!key) {
      throw new Error(
        "The service account key is not valid service account JSON (raw or base64). Check GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_SERVICE_ACCOUNT_KEY_FILE."
      );
    }
    // JWT extends OAuth2Client, so downstream code is unchanged
    return new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: SCOPES,
    });
  }

  const {
    GOOGLE_CLIENT_ID: clientId,
    GOOGLE_CLIENT_SECRET: clientSecret,
    GOOGLE_REFRESH_TOKEN: refreshToken,
  } = process.env;
  if (clientId && clientSecret && refreshToken) {
    const client = new OAuth2Client({ clientId, clientSecret });
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  return null;
}

/**
 * Short description of which credentials are in use, for startup logs.
 * Never includes secret values.
 */
export function describeAuth(auth: OAuth2Client): string {
  if (auth instanceof JWT) {
    return `service account ${auth.email}`;
  }
  return "OAuth refresh token";
}
