#!/usr/bin/env node

/**
 * One-time helper to obtain a GOOGLE_REFRESH_TOKEN for a Desktop-app
 * OAuth client. Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from the
 * environment, prints a consent URL, accepts the pasted code (or the whole
 * redirect URL), and prints only the refresh token.
 *
 * Nothing is written to disk. Instructions go to stderr so stdout carries
 * just the token.
 */

import * as readline from "readline";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";

import { SCOPES } from "./auth.js";

// Desktop-app OAuth clients accept loopback redirects without registration.
// Nothing listens here: the browser shows a "can't connect" page and the
// user copies the code from the address bar.
const REDIRECT_URI = "http://localhost";

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function extractCode(input: string): string {
  if (input.startsWith("http")) {
    const url = new URL(input);
    const error = url.searchParams.get("error");
    if (error) {
      throw new Error(`Google returned an error: ${error}`);
    }
    const code = url.searchParams.get("code");
    if (!code) {
      throw new Error("That URL has no ?code= parameter. Copy the full address after approving access.");
    }
    return code;
  }
  // A bare code may arrive URL-encoded (e.g. "4%2F0A...")
  return decodeURIComponent(input);
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(`
GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set as environment
variables (from your Google Cloud "Desktop app" OAuth client).

PowerShell:
  $env:GOOGLE_CLIENT_ID = "..."; $env:GOOGLE_CLIENT_SECRET = "..."; npm run setup-auth

macOS / Linux:
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run setup-auth
`);
    process.exit(1);
  }

  const client = new OAuth2Client({ clientId, clientSecret, redirectUri: REDIRECT_URI });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();

  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  console.error(`
1. Open this URL in an incognito/private window and sign in with the
   Google account that has access to your GA4 properties:

${authUrl}

2. Approve read-only Google Analytics access.

3. Your browser will then go to http://localhost/?code=... and show a
   "can't connect" page. That is expected. Copy the FULL address from the
   address bar (or just the code value) and paste it below.
`);

  const input = await ask("Paste the URL or code here: ");
  if (!input) {
    console.error("Nothing pasted; aborting.");
    process.exit(1);
  }

  try {
    const { tokens } = await client.getToken({ code: extractCode(input), codeVerifier });
    if (!tokens.refresh_token) {
      console.error(
        "\nGoogle did not return a refresh token. Remove this app's access at https://myaccount.google.com/permissions and run setup-auth again."
      );
      process.exit(1);
    }
    if (tokens.scope && !tokens.scope.split(" ").includes(SCOPES[0])) {
      console.error(`\nWarning: the granted scopes (${tokens.scope}) do not include ${SCOPES[0]}.`);
    }

    console.error(
      "\nSuccess. Your refresh token is below. Store it only as the GOOGLE_REFRESH_TOKEN variable on your host (e.g. Railway); do not commit it or share it.\n"
    );
    console.log(tokens.refresh_token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nCould not exchange the code: ${message}`);
    if (message.includes("invalid_grant")) {
      console.error("Codes are single-use and expire in minutes; run setup-auth again and paste the new code promptly.");
    }
    process.exit(1);
  }
}

main();
