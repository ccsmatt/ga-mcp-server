# Google Analytics 4 MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io) server that lets Claude query Google Analytics 4. Deploy it once (for example on Railway), add it to your Claude Team plan as a custom connector, and anyone on the team can ask things like:

- "Which channels drove the most sessions and key events last month?"
- "Top 20 landing pages from Organic Search in the last 28 days, with engagement rate"
- "Compare this month's sessions by device to last month"
- "How many people are on the site right now, and from which countries?"

It is **read-only**: it only ever requests the `https://www.googleapis.com/auth/analytics.readonly` scope and has no tools that change anything in GA4.

> Based on [ccsmatt/gsc-mcp-server](https://github.com/ccsmatt/gsc-mcp-server), a fork of [sofianbettayeb/gsc-mcp-server](https://github.com/sofianbettayeb/gsc-mcp-server) by Sofian Bettayeb (MIT). The HTTP transport and deployment setup come from that project; the Search Console tools were replaced with GA4 tools.

## Tools

| Tool | What it does |
| --- | --- |
| `ga_list_properties` | Lists GA4 accounts and properties the Google account can read, with property IDs |
| `ga_get_property` | Details for one property: time zone, currency, data streams (website URL, measurement ID) |
| `ga_run_report` | Historical report (Data API `runReport`): date ranges, dimensions, metrics, filters, sorting, row limit (default 100, max 1000) |
| `ga_run_realtime_report` | Last 30 minutes of activity (`runRealtimeReport`) |
| `ga_get_metadata` | Custom dimensions and metrics on a property (optionally all standard ones too) |

## How it works

- One HTTP endpoint, `POST /mcp` (stateless streamable HTTP), plus `GET /healthz` for health checks.
- Every `/mcp` request must carry `Authorization: Bearer <MCP_AUTH_TOKEN>`. The server **refuses to start** if `MCP_AUTH_TOKEN` is not set.
- The server reads GA4 as **one identity**: either a **service account** (a robot Google account) or the Google account that created the refresh token. Everyone who uses the connector sees what that identity can see, so give it Viewer access to exactly the properties your team should query.
- All credentials come from environment variables. Nothing is written to disk.

### Environment variables

Set **either** the service account variables **or** the three OAuth variables. If a service account key is set, it is used and the OAuth variables are ignored.

| Variable | Required | Description |
| --- | --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | option A | Service account key JSON, raw or base64-encoded (recommended for Railway) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | option A | Path to the key JSON file instead (used only if `GOOGLE_SERVICE_ACCOUNT_KEY` is not set) |
| `GOOGLE_CLIENT_ID` | option B | OAuth client ID (Desktop app type) |
| `GOOGLE_CLIENT_SECRET` | option B | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | option B | From `npm run setup-auth` |
| `MCP_AUTH_TOKEN` | yes | Long random string Claude must send as a Bearer token |
| `PORT` | no | Listen port (default 8080; Railway sets this for you) |

Both options use only the read-only scope `https://www.googleapis.com/auth/analytics.readonly`.

## 1. Google Cloud setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick an existing one).
2. **Enable the two APIs** (APIs & Services > Library), searching for each:
   - **Google Analytics Data API**
   - **Google Analytics Admin API**

Then follow **either** option A or option B.

### Which option?

- **Option A: service account (recommended).** No consent screen, no Google app verification, and the key doesn't expire after 7 days. You add the service account's email as a Viewer on each GA4 property, the same way you'd add a person. This is the way to go if your main Google account is a **personal Gmail** account: there, an unverified OAuth app is either blocked or limited to 7-day tokens.
- **Option B: OAuth refresh token.** Signs in as a real Google account, so it sees every property that account can see without adding anything in GA4. Best if your account is part of a **Google Workspace** organization (consent screen set to *Internal*).

## 2A. Option A: service account

1. In Google Cloud Console, go to **IAM & Admin > Service Accounts > Create service account**.
   - Name: e.g. `ga4-mcp`. Click **Create and continue**.
   - Skip the optional "grant access" steps (it needs no Cloud roles) and click **Done**.
2. Copy the service account's **email** (looks like `ga4-mcp@your-project.iam.gserviceaccount.com`).
3. Open the service account > **Keys > Add key > Create new key > JSON > Create**. A `.json` key file downloads.
   - Save it **outside** this repo folder (e.g. your password manager), never commit it.
   - If key creation is blocked with an organization policy error (`iam.disableServiceAccountKeyCreation`), an organization admin has to allow keys for this project.
4. **Give it access in GA4.** For each property (or once per GA4 account to cover all its properties): GA4 **Admin > Property access management** (or **Account access management**) > **+ > Add users**, paste the service account email, choose role **Viewer**, untick *Notify new users by email*, click **Add**.
5. **Turn the key into one line for Railway.** Base64-encode the file and copy it to the clipboard:

   PowerShell (Windows):

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\key.json")) | Set-Clipboard
   ```

   macOS:

   ```bash
   base64 -i /path/to/key.json | tr -d '\n' | pbcopy
   ```

   You'll paste this as `GOOGLE_SERVICE_ACCOUNT_KEY` in step 5. (Raw JSON also works, but base64 avoids problems with the line breaks in the private key.)

Then skip to [step 4](#4-choose-an-mcp-auth-token).

To revoke access later, delete the key (or the whole service account) in Google Cloud, or remove its email from GA4.

## 2B. Option B: OAuth refresh token

### Configure the OAuth consent screen

In Google Auth Platform:

- **Branding**: app name (e.g. "GA4 MCP"), your support email.
- **Audience**:
  - If your Google account is part of a **Google Workspace** organization, choose **Internal**. Tokens don't expire and no verification is needed.
  - Otherwise choose **External**, add yourself as a test user, then **Publish app** (set to *In production*). Apps left in *Testing* issue refresh tokens that **expire after 7 days**. An unverified production app shows an "unverified app" warning during consent; as the owner you can click *Advanced > Go to ... (unsafe)* to continue. Some personal Gmail accounts instead get a hard **"This app is blocked"** page; if that happens, use option A.
- **Data Access**: add the scope `https://www.googleapis.com/auth/analytics.readonly` (shown as ".../auth/analytics.readonly").

### Create the OAuth client

1. Google Auth Platform > **Clients** > **Create client**.
2. Application type: **Desktop app**. Give it a name and click **Create**.
3. Copy the **Client ID** and **Client secret**. Don't download the JSON into this repo (it's git-ignored, but there's no need for it).

Make sure the Google account you'll sign in with has at least **Viewer** access on each GA4 property (GA4 > Admin > Property access management).

### Get a refresh token

You need [Node.js 22+](https://nodejs.org/) and a copy of this repo.

```bash
git clone https://github.com/ccsmatt/ga-mcp-server.git
cd ga-mcp-server
npm install
```

Then run the helper with your client ID and secret as environment variables.

PowerShell (Windows):

```powershell
$env:GOOGLE_CLIENT_ID = "your-client-id.apps.googleusercontent.com"
$env:GOOGLE_CLIENT_SECRET = "your-client-secret"
npm run setup-auth
```

macOS / Linux:

```bash
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com" GOOGLE_CLIENT_SECRET="your-client-secret" npm run setup-auth
```

The script:

1. Prints a Google consent URL. Open it in an **incognito/private window** and sign in with the Google account that has GA4 access.
2. After you approve, your browser goes to `http://localhost/?code=...` and shows a **"can't connect"** page. That's expected.
3. Copy the full address from the address bar (or just the `code` value) and paste it into the terminal.
4. The script prints **only the refresh token**. Copy it somewhere safe for step 5 (e.g. your password manager).

Nothing is written to disk. Close the terminal afterwards so the client secret isn't left in its environment.

If you get `invalid_grant`, the code expired or was already used; run it again and paste promptly.

## 4. Choose an MCP auth token

`MCP_AUTH_TOKEN` is the password Claude uses to call your server. Generate a long random one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 5. Deploy to Railway

1. In [Railway](https://railway.com/), click **New Project** > **Deploy from GitHub repo** and pick `ga-mcp-server`. Railway finds the `Dockerfile` and builds with it.
2. Open the service > **Variables** and add:
   - `MCP_AUTH_TOKEN`
   - Option A: `GOOGLE_SERVICE_ACCOUNT_KEY` (the base64 text from step 2A)
   - Option B: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`

   Don't set `PORT`; Railway provides it. If you switch from option B to A, delete the three OAuth variables so it's clear which one is in use.
3. **Settings > Networking > Generate Domain** to get a public URL like `https://ga-mcp-server-production.up.railway.app`.
4. Optional: **Settings > Deploy > Healthcheck Path** = `/healthz`.
5. Check it: opening `https://<your-domain>/healthz` should show `{"status":"ok"}`. The deploy logs should say `ga-mcp-server listening on port ...` and `Google credentials: service account <email>` (or `OAuth refresh token`). If the logs say a variable is missing, fix it under **Variables** (Railway redeploys automatically).

Your MCP endpoint is `https://<your-domain>/mcp`.

## 6. Add it to Claude (Team plan)

An **Owner** of the Claude Team organization does this once:

1. Go to [**Organization settings > Connectors**](https://claude.ai/admin-settings/connectors), select **Add**, then **Custom** (choose **Web** if asked).
2. **Name**: e.g. "Google Analytics 4". **MCP server URL**: `https://<your-domain>/mcp`.
3. **Authentication**: **No sign-in**.
4. **Request headers**: choose header name `authorization`, value `Bearer <your MCP_AUTH_TOKEN>`. Type the word `Bearer`, a space, then the token; Claude sends the value exactly as entered. Mark it **Required**.
5. Click **Add**.

Team members then go to **Customize > Connectors**, find the connector with the **Custom** label and click **Connect**. In a chat, turn it on from the **+** menu > **Connectors**.

> Request header authentication is in beta for a limited set of organizations. If you don't see **Request headers** in the dialog, your org doesn't have it yet, and this server (which only accepts the header) can't be added from claude.ai until it does. It still works from Claude Code, which supports headers today.

To change the token later, update `MCP_AUTH_TOKEN` in Railway, then remove and re-add the connector with the new header (headers can't be edited after saving).

### Claude Code (CLI)

```bash
claude mcp add --transport http ga4 https://<your-domain>/mcp --header "Authorization: Bearer <your MCP_AUTH_TOKEN>"
```

## Local development

```bash
cp .env.example .env    # fill in real values; .env is git-ignored
npm run build
npm start               # or: npm run dev
```

`npm start` doesn't load `.env` by itself; export the variables in your shell first (or use your editor's env support). Then check `http://localhost:8080/healthz`.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `Permission denied (403)` | The Google account or service account email needs Viewer access on that GA4 property, or the property ID is wrong. |
| `ga_list_properties` returns no accounts | Service account: its email hasn't been added to any GA4 property or account yet (step 2A.4). |
| `API is not enabled` | Enable both **Google Analytics Data API** and **Google Analytics Admin API** in the same Cloud project as the service account or OAuth client. |
| `not valid service account JSON` at startup | `GOOGLE_SERVICE_ACCOUNT_KEY` was pasted incompletely. Re-copy the whole base64 text (or the whole JSON file). |
| `Google rejected the service account key` | The key was deleted or disabled. Create a new key and update `GOOGLE_SERVICE_ACCOUNT_KEY`. |
| `invalid_grant` | Refresh token revoked or expired (7-day expiry if the consent screen is External + Testing). Re-run `npm run setup-auth` and update `GOOGLE_REFRESH_TOKEN`, or switch to option A. |
| "This app is blocked" during `setup-auth` | Google blocked the unverified OAuth app for this account. Use option A (service account). |
| `Google rejected the OAuth client` | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` don't match the client used to create the refresh token. |
| `401 Unauthorized` from `/mcp` | The connector isn't sending `Authorization: Bearer <MCP_AUTH_TOKEN>`, or the value doesn't match exactly (check for a missing `Bearer `). |
| Server exits at startup | Read the deploy log: it names the missing variable. |

## Security notes

- Never commit `.env`, service account keys, OAuth client JSON or tokens. `.gitignore` and `.dockerignore` block the usual file names, but keep key files outside the repo folder anyway.
- The service account key grants read access to every GA4 property its email has been added to. Store it only in Railway variables (and your password manager). Revoke it any time by deleting the key in Google Cloud.
- The refresh token grants read access to every GA4 property the Google account can see. Store it only in Railway variables. Revoke it any time at [Google Account permissions](https://myaccount.google.com/permissions).
- Anyone with `MCP_AUTH_TOKEN` and the URL can read that GA4 data. Rotate it if it leaks.

## Privacy

See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## License

MIT. See [LICENSE](LICENSE). Originally derived from [gsc-mcp-server](https://github.com/sofianbettayeb/gsc-mcp-server) by Sofian Bettayeb.
