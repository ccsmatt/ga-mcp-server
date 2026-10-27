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
- The server reads GA4 as **one Google account** (whoever created the refresh token). Everyone who uses the connector sees what that account can see, so use an account with Viewer access to exactly the properties your team should query.
- All credentials come from environment variables. Nothing is written to disk.

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | yes | OAuth client ID (Desktop app type) |
| `GOOGLE_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | yes | From `npm run setup-auth` (step 3) |
| `MCP_AUTH_TOKEN` | yes | Long random string Claude must send as a Bearer token |
| `PORT` | no | Listen port (default 8080; Railway sets this for you) |

## 1. Google Cloud setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or pick an existing one).
2. **Enable the two APIs** (APIs & Services > Library), searching for each:
   - **Google Analytics Data API**
   - **Google Analytics Admin API**
3. **Configure the OAuth consent screen** (Google Auth Platform):
   - **Branding**: app name (e.g. "GA4 MCP"), your support email.
   - **Audience**:
     - If your Google account is part of a **Google Workspace** organization, choose **Internal**. Tokens don't expire and no verification is needed.
     - Otherwise choose **External**, add yourself as a test user, then **Publish app** (set to *In production*). Apps left in *Testing* issue refresh tokens that **expire after 7 days**. An unverified production app shows an "unverified app" warning during consent; as the owner you can click *Advanced > Go to ... (unsafe)* to continue.
   - **Data Access**: add the scope `https://www.googleapis.com/auth/analytics.readonly` (shown as ".../auth/analytics.readonly").

## 2. Create the OAuth client

1. Google Auth Platform > **Clients** > **Create client**.
2. Application type: **Desktop app**. Give it a name and click **Create**.
3. Copy the **Client ID** and **Client secret**. Don't download the JSON into this repo (it's git-ignored, but there's no need for it).

Make sure the Google account you'll sign in with has at least **Viewer** access on each GA4 property (GA4 > Admin > Property access management).

## 3. Get a refresh token

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
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `MCP_AUTH_TOKEN`

   Don't set `PORT`; Railway provides it.
3. **Settings > Networking > Generate Domain** to get a public URL like `https://ga-mcp-server-production.up.railway.app`.
4. Optional: **Settings > Deploy > Healthcheck Path** = `/healthz`.
5. Check it: opening `https://<your-domain>/healthz` should show `{"status":"ok"}`. The deploy logs should say `ga-mcp-server listening on port ...`. If the logs say a variable is missing, fix it under **Variables** (Railway redeploys automatically).

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
| `Permission denied (403)` | The Google account needs Viewer access on that GA4 property, or the property ID is wrong. |
| `API is not enabled` | Enable both **Google Analytics Data API** and **Google Analytics Admin API** in the same Cloud project as the OAuth client. |
| `invalid_grant` | Refresh token revoked or expired (7-day expiry if the consent screen is External + Testing). Re-run `npm run setup-auth` and update `GOOGLE_REFRESH_TOKEN`. |
| `Google rejected the OAuth client` | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` don't match the client used to create the refresh token. |
| `401 Unauthorized` from `/mcp` | The connector isn't sending `Authorization: Bearer <MCP_AUTH_TOKEN>`, or the value doesn't match exactly (check for a missing `Bearer `). |
| Server exits at startup | Read the deploy log: it names the missing variable. |

## Security notes

- Never commit `.env`, OAuth client JSON or tokens. `.gitignore` and `.dockerignore` block the usual file names.
- The refresh token grants read access to every GA4 property the Google account can see. Store it only in Railway variables. Revoke it any time at [Google Account permissions](https://myaccount.google.com/permissions).
- Anyone with `MCP_AUTH_TOKEN` and the URL can read that GA4 data. Rotate it if it leaks.

## Privacy

See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## License

MIT. See [LICENSE](LICENSE). Originally derived from [gsc-mcp-server](https://github.com/sofianbettayeb/gsc-mcp-server) by Sofian Bettayeb.
