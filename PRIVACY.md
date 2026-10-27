# Privacy Policy

**Google Analytics 4 MCP Server**

Last updated: October 27, 2026

## Overview

Google Analytics 4 MCP Server is an open-source, self-hosted tool that connects Claude (and other MCP clients) to Google Analytics 4 data. Each deployment is run by whoever hosts it; this document describes how the software handles data.

## What data is accessed

Using the read-only scope `https://www.googleapis.com/auth/analytics.readonly`, the server can read:

- The GA4 accounts and properties the authorizing Google account can access
- Property settings and data streams (e.g. time zone, currency, website URL)
- Report data (dimensions and metrics) and realtime data requested by the MCP client
- Custom dimension and metric definitions

It cannot change any GA4 settings or data.

## Where data goes

- Credentials (OAuth client, refresh token, MCP auth token) are supplied as environment variables on the host. The software does not write them to disk.
- Report data is fetched from Google on request and returned directly to the MCP client that asked for it (for example Claude). The software does not store, cache or log report data.
- Your host (e.g. Railway) and your MCP client (e.g. Claude) handle data under their own privacy policies.

## Third-party services

- **Google Analytics Data API and Admin API** to read analytics data
- **Google OAuth 2.0** for authentication

Use of these services is subject to [Google's Privacy Policy](https://policies.google.com/privacy).

## Data sharing

The software itself does not collect personal information, send data to the authors, track usage, or share data with third parties.

## Revoking access

- Revoke the refresh token at [Google Account permissions](https://myaccount.google.com/permissions)
- Remove the credentials from your host's environment variables
- Remove the connector from your MCP client

## Open source

Source code: https://github.com/ccsmatt/ga-mcp-server

## Contact

GitHub Issues: https://github.com/ccsmatt/ga-mcp-server/issues

## Changes

Updates to this policy will be reflected in this document with a new date.
