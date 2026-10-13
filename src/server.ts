import { createServer } from "node:http";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import { safeError } from "./errors.js";
import {
  diagnosisSchema,
  fileSchema,
  supportedSchema,
  usageSchema,
} from "./schemas.js";
import type { ToolService } from "./service.js";
async function result(operation: () => Promise<Record<string, unknown>>) {
  try {
    const data = await operation();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data) }],
      structuredContent: data,
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ success: false, error: safeError(error) }),
        },
      ],
    };
  }
}
export function createPlantLabServer(service: ToolService) {
  const server = new McpServer(
    { name: "mcp-plantlab", version: "0.1.0" },
    {
      instructions:
        "Local single-account PlantLab adapter. Diagnose only after an explicit user request to analyze the selected photo. Do not repeat failed or uncertain diagnoses automatically. Keep findings separate from advice. Missing fields do not mean healthy.",
    },
  );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    "get_supported_diagnoses",
    {
      description:
        "Read supported species, diagnosis scope, public-contract capabilities, and file limits. The species list is a dated contract snapshot.",
      inputSchema: z.object({}).strict(),
      outputSchema: supportedSchema,
      annotations: readOnly,
    },
    () => result(() => service.supported()),
  );
  server.registerTool(
    "get_usage",
    {
      description:
        "Read daily and monthly diagnosis allowance for the one account configured on this local server.",
      inputSchema: z.object({}).strict(),
      outputSchema: usageSchema,
      annotations: readOnly,
    },
    () => result(() => service.usage()),
  );
  server.registerTool(
    "diagnose_plant",
    {
      description:
        "Analyze one user-selected photo only after an explicit diagnosis request. Uses account quota and can write account history. Photo handling follows PlantLab account consent and retention policy. This local adapter does not prove a no-capture policy for ChatGPT. Never automatically repeat a failed or uncertain diagnosis. A deliberate later call can consume more allowance. Report suspected findings and uncertainty as supplied. Missing health fields do not mean healthy.",
      inputSchema: z.object({ image: fileSchema }).strict(),
      outputSchema: diagnosisSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      _meta: { "openai/fileParams": ["image"] },
    },
    ({ image }) => result(() => service.diagnose(image)),
  );
  return server;
}
export async function startServer(service: ToolService, port = 3000) {
  const handler = createMcpHandler(() => createPlantLabServer(service), {
    maxRequestBodySize: 65536,
    maxSubscriptions: 0,
  });
  const nodeHandler = toNodeHandler(handler, { maxRequestBodySize: 65536 });
  const hostAllowed = localhostHostValidation();
  const http = createServer((req, res) => {
    if (!hostAllowed(req, res)) return;
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    // No browser origin is needed for a local MCP client. Reject browser requests.
    if (req.headers.origin) {
      res.writeHead(403).end();
      return;
    }
    void nodeHandler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  http.requestTimeout = 10_000;
  http.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, "127.0.0.1", () => {
      http.removeListener("error", reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === "string")
    throw Error("Local listener unavailable");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeIdleConnections();
      });
    },
  };
}
