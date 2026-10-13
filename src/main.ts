import { HttpPlantLabClient } from "./client.js";
import { FileDownloader } from "./files.js";
import { ToolService } from "./service.js";
import { startServer } from "./server.js";
async function main() {
  const key = process.env.PLANTLAB_API_KEY;
  if (!key) throw Error("Set PLANTLAB_API_KEY through the server environment.");
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw Error("Set PORT to an integer from 1 to 65535.");
  const api = new HttpPlantLabClient(
    process.env.PLANTLAB_API_URL ?? "https://api.plantlab.ai",
    key,
  );
  const origins = (process.env.PLANTLAB_FILE_ORIGINS ?? "")
    .split(",")
    .filter(Boolean)
    .map((s) => s.trim());
  const server = await startServer(
    new ToolService(api, new FileDownloader(origins)),
    port,
  );
  console.log("PlantLab MCP is ready on the loopback /mcp endpoint.");
  const close = () => {
    void server.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
void main().catch(() => {
  console.error(
    "PlantLab MCP startup failed. Make sure that the server environment configuration is valid.",
  );
  process.exitCode = 1;
});
