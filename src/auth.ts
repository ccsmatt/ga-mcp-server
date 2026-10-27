import { OAuth2Client } from "google-auth-library";

/**
 * The only scope this server ever requests: read-only Google Analytics.
 */
export const SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"];

/**
 * Build an authenticated Google client purely from environment variables:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *
 * The refresh token is exchanged for short-lived access tokens on demand,
 * so nothing is ever written to disk.
 *
 * Returns null if any of the three variables is missing.
 */
export function getAuthFromEnv(): OAuth2Client | null {
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
