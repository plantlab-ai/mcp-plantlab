import assert from "node:assert/strict";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { HttpPlantLabClient } from "../src/client.js";
import { validatePhoto } from "../src/files.js";
import { startServer } from "../src/server.js";
import { ToolService } from "../src/service.js";
import { startMockApi } from "./mock-api.js";
const mock = await startMockApi();
// Inject synthetic bytes. The production HTTPS downloader remains unchanged.
const service = new ToolService(new HttpPlantLabClient(mock.url, mock.key), {
  download: async () => validatePhoto(mock.png),
});
const server = await startServer(service, 0);
const client = new Client({ name: "plantlab-mock-demo", version: "0.1.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 3);
  console.log(
    "MCP initialization passed. Tools:",
    tools.map((t) => t.name).join(", "),
  );
  for (const name of [
    "get_supported_diagnoses",
    "get_usage",
    "diagnose_plant",
  ]) {
    const result = await client.callTool({
      name,
      arguments:
        name === "diagnose_plant"
          ? {
              image: {
                download_url: "https://files.example.test/synthetic.png",
                file_id: "synthetic-demo",
              },
            }
          : {},
    });
    assert.notEqual(result.isError, true);
    console.log(name, JSON.stringify(result.structuredContent));
  }
  assert.equal(mock.calls.filter((c) => c.path === "/diagnose").length, 1);
  console.log(
    "Mock API received exactly one diagnosis. No live diagnosis ran.",
  );
} finally {
  await client.close();
  await server.close();
  await mock.close();
}
