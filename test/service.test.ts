import assert from "node:assert/strict";
import { test } from "node:test";
import { ToolService } from "../src/service.js";
import { AdapterError } from "../src/errors.js";
const image = {
  download_url: "https://files.example.test/photo",
  file_id: "same-file",
};
const response = {
  success: true,
  species: null,
  species_name: null,
  species_confidence: null,
  in_scope: false,
  routed_reason: "unknown_species",
  results: [],
};
const photo = {
  bytes: Buffer.from("fixture"),
  mime: "image/png" as const,
  filename: "image.png",
};
test("coalesces active duplicates, releases results, and isolates account instances", async () => {
  let calls = 0;
  const api = {
    info: async () => ({}),
    usage: async () => ({}),
    diagnose: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return response;
    },
  };
  const files = { download: async () => photo };
  const a = new ToolService(api, files);
  const b = new ToolService(api, files);
  const values = await Promise.all([
    a.diagnose(image),
    a.diagnose(image),
    b.diagnose(image),
  ]);
  assert.equal(calls, 2);
  assert.deepEqual(values[0], response);
  await a.diagnose(image);
  assert.equal(calls, 3);
});
test("invalid file makes zero diagnosis requests", async () => {
  let calls = 0;
  const s = new ToolService(
    {
      info: async () => ({}),
      usage: async () => ({}),
      diagnose: async () => {
        calls++;
        return response;
      },
    },
    {
      download: async () => {
        throw new AdapterError("INVALID_IMAGE", "Invalid image.");
      },
    },
  );
  await assert.rejects(s.diagnose(image));
  assert.equal(calls, 0);
});
test("does not retry ambiguous diagnosis and removes failed active entry", async () => {
  let calls = 0;
  const s = new ToolService(
    {
      info: async () => ({}),
      usage: async () => ({}),
      diagnose: async () => {
        calls++;
        throw new AdapterError(
          "COMPLETION_UNKNOWN",
          "Diagnosis completion is unknown.",
          true,
        );
      },
    },
    { download: async () => photo },
  );
  await assert.rejects(Promise.all([s.diagnose(image), s.diagnose(image)]));
  assert.equal(calls, 1);
  await assert.rejects(s.diagnose(image));
  assert.equal(calls, 2);
});

test("limits active distinct files while still coalescing duplicates", async () => {
  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  const s = new ToolService(
    {
      info: async () => ({}),
      usage: async () => ({}),
      diagnose: async () => {
        calls++;
        await held;
        return response;
      },
    },
    { download: async () => photo },
  );
  const active = Array.from({ length: 4 }, (_, i) =>
    s.diagnose({ ...image, file_id: `file-${i}` }),
  );
  const duplicate = s.diagnose({ ...image, file_id: "file-0" });
  await assert.rejects(
    s.diagnose({ ...image, file_id: "file-4" }),
    /Four photos/,
  );
  release();
  await Promise.all([...active, duplicate]);
  assert.equal(calls, 4);
});
test("reads formats and body limits from info while naming snapshot species source", async () => {
  const s = new ToolService(
    {
      info: async () => ({
        capabilities: { image_formats: ["png", "webp"], max_file_size_mb: 5 },
      }),
      usage: async () => ({}),
      diagnose: async () => response,
    },
    { download: async () => photo },
  );
  const result = await s.supported();
  assert.deepEqual(result.image_formats, ["png"]);
  assert.equal(result.max_photo_bytes, 4 * 1024 * 1024);
  assert.match(result.capabilities_source, /snapshot/);
  assert.equal(
    result.species[1]?.diagnoses.includes("spotted_wilt_virus"),
    false,
  );
});
