#!/usr/bin/env node

import { createHash, timingSafeEqual } from "crypto";
import express, { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { getAuthFromEnv } from "./auth.js";
import { GAClient } from "./ga-client.js";
import { createMcpServer } from "./server.js";

const PORT = Number(process.env.PORT || 8080);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// Only the Authorization header is accepted; tokens in URLs leak into logs
function isAuthorized(req: Request): boolean {
  const header = req.headers.authorization;
  if (!AUTH_TOKEN || !header) {
    return false;
  }
  // Hash both sides so the comparison is constant-time regardless of length
  return timingSafeEqual(sha256(header), sha256(`Bearer ${AUTH_TOKEN}`));
}

function unauthorized(res: Response): void {
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}

async function main() {
  if (!AUTH_TOKEN) {
    console.error(`
Google Analytics 4 MCP Server - MCP_AUTH_TOKEN required

Refusing to start without MCP_AUTH_TOKEN: the server would otherwise let
anyone who can reach it read your Google Analytics data.

Set MCP_AUTH_TOKEN to a long random string, and send it from MCP clients
as the header:  Authorization: Bearer <MCP_AUTH_TOKEN>
`);
    process.exit(1);
  }

  const auth = getAuthFromEnv();
  if (!auth) {
    console.error(`
Google Analytics 4 MCP Server - Google credentials required

Set all three environment variables:
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  GOOGLE_REFRESH_TOKEN   (get one with: npm run setup-auth)

See the README for details.
`);
    process.exit(1);
  }

  const gaClient = new GAClient(auth);

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  app.get("/healthz", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  const handleMcp = async (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      unauthorized(res);
      return;
    }

    // Stateless mode: a fresh Server + transport per request, all sharing
    // one authenticated GA client
    const server = createMcpServer(gaClient);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on("close", () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("Error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };

  // Stateless streamable HTTP: sessions and server-initiated streams are
  // not supported, so GET/DELETE get 405 per the MCP spec
  const methodNotAllowed = (req: Request, res: Response) => {
    if (!isAuthorized(req)) {
      unauthorized(res);
      return;
    }
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };

  app.post("/mcp", handleMcp);
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  app.listen(PORT, () => {
    console.log(`ga-mcp-server listening on port ${PORT}`);
    console.log("MCP endpoint: POST /mcp (Authorization: Bearer token required)");
  });
}

main();
