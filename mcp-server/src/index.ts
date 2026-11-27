import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import {
  MODELS,
  getModel,
  parseSettings,
} from "../../src/generation/catalog/index.js";

const host = process.env.MCP_HOST ?? "127.0.0.1";
const port = Number(process.env.MCP_PORT ?? 8787);
const authToken = process.env.MCP_AUTH_TOKEN;

if (!authToken || authToken.length < 32) {
  throw new Error("MCP_AUTH_TOKEN must be set and at least 32 characters long.");
}

function isAuthorized(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(authToken);

  return supplied.length === expected.length &&
    timingSafeEqual(supplied, expected);
}

function createMcpServer() {
  const server = new McpServer({
    name: "openhiggsfield",
    version: "0.1.0",
  });

  server.tool(
    "list_models",
    "List available OpenHiggsfield image and video models.",
    {},
    async () => ({
      content: [{
        type: "text",
        text: JSON.stringify(
          MODELS.map(({ id, label, surface }) => ({ id, label, surface })),
          null,
          2,
        ),
      }],
    }),
  );

  server.tool(
    "get_model_details",
    "Get the settings and supported media roles for a model.",
    { model_id: z.string() },
    async ({ model_id }) => {
      try {
        const model = getModel(model_id);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(model, null, 2),
          }],
        };
      } catch {
        return {
          isError: true,
          content: [{
            type: "text",
            text: `Unknown model: ${model_id}`,
          }],
        };
      }
    },
  );

  server.tool(
    "validate_generation_request",
    "Validate model settings without submitting or generating anything.",
    {
      model_id: z.string(),
      settings: z.record(z.string(), z.unknown()),
    },
    async ({ model_id, settings }) => {
      try {
        const model = getModel(model_id);
        const validated = parseSettings(model, settings);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              valid: true,
              model: model.id,
              settings: validated,
              note: "Validation only. No generation was submitted.",
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{
            type: "text",
            text: error instanceof Error ? error.message : "Validation failed.",
          }],
        };
      }
    },
  );

  return server;
}

const httpServer = createServer(async (req, res) => {
  if (req.url !== "/mcp") {
    res.writeHead(404).end("Not found");
    return;
  }

  if (!isAuthorized(req.headers.authorization)) {
    res.writeHead(401, {
      "WWW-Authenticate": "Bearer",
    }).end("Unauthorized");
    return;
  }

  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Internal server error");
    }
  }
});

httpServer.listen(port, host, () => {
  console.log(`OpenHiggsfield MCP server listening on http://${host}:${port}/mcp`);
});
