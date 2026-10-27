import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { GAClient } from "./ga-client.js";
import { TOOL_DEFINITIONS, handleToolCall } from "./tools.js";

/**
 * Build an MCP Server wired to the GA4 tool handlers.
 */
export function createMcpServer(gaClient: GAClient): Server {
  const server = new Server(
    {
      name: "ga-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOL_DEFINITIONS,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(gaClient, name, args || {});
  });

  return server;
}
