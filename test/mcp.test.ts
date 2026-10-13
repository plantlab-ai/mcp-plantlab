import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "node:http";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { startServer } from "../src/server.js";
import { ToolService } from "../src/service.js";
import { HttpPlantLabClient } from "../src/client.js";
import { startMockApi } from "../examples/mock-api.js";
import { validatePhoto } from "../src/files.js";
test("initializes Streamable HTTP, lists exact schemas and calls all three tools against mock", async () => {
  const mock = await startMockApi();
  const service = new ToolService(new HttpPlantLabClient(mock.url, mock.key), {
    download: async () => validatePhoto(mock.png),
  });
  const server = await startServer(service, 0);
  const client = new Client({ name: "smoke", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url)),
    );
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "diagnose_plant",
      "get_supported_diagnoses",
      "get_usage",
    ]);
    for (const t of tools) {
      assert.ok(t.outputSchema);
      assert.equal(t.annotations?.destructiveHint, false);
    }
    const tool = tools.find((t) => t.name === "diagnose_plant")!;
    assert.equal(tool.annotations?.readOnlyHint, false);
    assert.equal(tool.annotations?.idempotentHint, false);
    assert.equal(tool.annotations?.openWorldHint, false);
    assert.deepEqual(tool._meta?.["openai/fileParams"], ["image"]);
    const image = (
      tool.inputSchema.properties as Record<
        string,
        { required: string[]; properties: Record<string, unknown> }
      >
    ).image!;
    assert.deepEqual(image.required, ["download_url", "file_id"]);
    assert.deepEqual(Object.keys(image.properties), [
      "download_url",
      "file_id",
      "mime_type",
      "file_name",
    ]);
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
                  download_url: "https://files.example.test/photo",
                  file_id: "fixture",
                },
              }
            : {},
      });
      assert.notEqual(result.isError, true);
      assert.ok(result.structuredContent);
    }
    assert.equal(mock.calls.filter((c) => c.path === "/diagnose").length, 1);
    assert.equal(
      (
        await client.callTool({
          name: "diagnose_plant",
          arguments: { api_key: "forbidden" },
        })
      ).isError,
      true,
    );
  } finally {
    await client.close();
    await server.close();
    await mock.close();
  }
});
test("rejects hostile Host, browser Origin and oversized HTTP payload", async () => {
  const mock = await startMockApi();
  const server = await startServer(
    new ToolService(new HttpPlantLabClient(mock.url, mock.key), {
      download: async () => validatePhoto(mock.png),
    }),
    0,
  );
  try {
    const hostile = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        server.url,
        { method: "POST", headers: { host: "evil.example.test" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end("{}");
    });
    assert.equal(hostile, 403);
    assert.equal(
      (
        await fetch(server.url, {
          method: "POST",
          headers: { origin: "https://evil.example.test" },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(server.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "x".repeat(65537),
        })
      ).status,
      413,
    );
    assert.equal(mock.calls.length, 0);
  } finally {
    await server.close();
    await mock.close();
  }
});

test("MCP quota errors stay neutral and never contain server credentials or upstream text", async () => {
  const mock = await startMockApi({ status: 429 });
  const server = await startServer(
    new ToolService(new HttpPlantLabClient(mock.url, mock.key), {
      download: async () => validatePhoto(mock.png),
    }),
    0,
  );
  const client = new Client({ name: "quota-smoke", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url)),
    );
    const result = await client.callTool({
      name: "diagnose_plant",
      arguments: {
        image: {
          download_url: "https://files.example.test/photo",
          file_id: "fixture",
        },
      },
    });
    assert.equal(result.isError, true);
    assert.doesNotMatch(
      JSON.stringify(result),
      /upgrade|checkout|private-response/,
    );
    assert.equal(JSON.stringify(result).includes(mock.key), false);
    assert.match(JSON.stringify(result), /QUOTA_EXCEEDED/);
    assert.equal(mock.calls.length, 1);
  } finally {
    await client.close();
    await server.close();
    await mock.close();
  }
});
