import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
export async function startMockApi(
  options: {
    status?: number;
    mode?: "timeout" | "malformed" | "oversized" | "redirect" | "empty";
  } = {},
) {
  const key = randomBytes(24).toString("hex");
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const calls: { path: string; keyAccepted: boolean; body: string }[] = [];
  const diagnosis = {
    success: true,
    species: "tomato",
    species_name: "Solanum lycopersicum",
    species_confidence: 0.9,
    in_scope: true,
    routed_reason: null,
    results: [
      {
        bbox: { x0: 0, y0: 0, x1: 1, y1: 1, normalized: true },
        is_healthy: false,
        health_confidence: 0.1,
        conditions: [
          {
            class_id: "early_blight",
            display_name: "Early blight",
            confidence: 0.4,
            suspected: true,
            coarse_group: "fungal_disease",
          },
        ],
        coarse_fallback: "fungal_disease",
        uncertainty_factors: ["Synthetic mock result. No real diagnosis."],
      },
    ],
  };
  const period = {
    used: 1,
    limit: 3,
    remaining: 2,
    resets_at: "2026-10-14T00:00:00Z",
  };
  const server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of req) {
        total += chunk.length;
        if (total > 10 * 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const keyAccepted = req.headers["x-api-key"] === key;
      calls.push({
        path: req.url ?? "",
        keyAccepted,
        body: Buffer.concat(chunks).toString("latin1"),
      });
      res.setHeader("content-type", "application/json");
      if (!keyAccepted) {
        res.writeHead(401).end("{}");
        return;
      }
      if (options.status) {
        res
          .writeHead(options.status)
          .end(
            JSON.stringify({ error: "private-response: upgrade or checkout" }),
          );
        return;
      }
      if (options.mode === "timeout") return;
      if (options.mode === "redirect") {
        res.writeHead(302, { location: "/elsewhere" }).end();
        return;
      }
      if (options.mode === "malformed") {
        res.end("{broken");
        return;
      }
      if (options.mode === "oversized") {
        res.end("x".repeat(1024 * 1024 + 1));
        return;
      }
      if (options.mode === "empty") {
        res.end();
        return;
      }
      if (req.method === "GET" && req.url === "/info")
        res.end(
          JSON.stringify({
            capabilities: {
              image_formats: ["jpg", "jpeg", "png"],
              max_file_size_mb: 10,
            },
          }),
        );
      else if (req.method === "GET" && req.url === "/usage")
        res.end(
          JSON.stringify({
            success: true,
            usage: { daily: period, monthly: period },
          }),
        );
      else if (req.method === "POST" && req.url === "/diagnose")
        res.end(JSON.stringify(diagnosis));
      else res.writeHead(404).end("{}");
    })().catch(() => {
      res.writeHead(500).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Mock unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    key,
    png,
    calls,
    diagnosis,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
