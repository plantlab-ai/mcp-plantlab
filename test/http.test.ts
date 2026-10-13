import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpPlantLabClient } from "../src/client.js";
import { startMockApi } from "../examples/mock-api.js";
import { safeError } from "../src/errors.js";
test("forwards API key only in header, minimal multipart, and preserves fixture results", async () => {
  const mock = await startMockApi();
  try {
    const api = new HttpPlantLabClient(mock.url, mock.key);
    assert.equal(
      ((await api.info()) as { capabilities: unknown }).capabilities !==
        undefined,
      true,
    );
    await api.usage();
    await api.diagnose({
      bytes: mock.png,
      mime: "image/png",
      filename: "image.png",
    });
    assert.equal(mock.calls.length, 3);
    assert.deepEqual(
      mock.calls.map((c) => c.keyAccepted),
      [true, true, true],
    );
    assert.equal(mock.calls[2]?.body.includes('name="image"'), true);
    assert.equal(mock.calls[2]?.body.includes(mock.key), false);
    assert.equal(mock.calls[2]?.body.includes("X-Verify"), false);
  } finally {
    await mock.close();
  }
});
for (const status of [401, 403, 429, 400, 500, 503])
  test(`upstream ${status} returns safe error with one diagnosis attempt`, async () => {
    const mock = await startMockApi({ status });
    try {
      const api = new HttpPlantLabClient(mock.url, mock.key);
      let error;
      try {
        await api.diagnose({
          bytes: mock.png,
          mime: "image/png",
          filename: "image.png",
        });
      } catch (e) {
        error = safeError(e);
      }
      assert.ok(error);
      assert.equal(mock.calls.length, 1);
      assert.equal(JSON.stringify(error).includes(mock.key), false);
      assert.doesNotMatch(
        JSON.stringify(error),
        /upgrade|checkout|private-response/,
      );
      assert.equal(error.completion_unknown, status >= 500);
      if (status === 429) assert.equal(error.code, "QUOTA_EXCEEDED");
    } finally {
      await mock.close();
    }
  });
for (const mode of [
  "timeout",
  "malformed",
  "oversized",
  "redirect",
  "empty",
] as const)
  test(`upstream ${mode} never retries and marks completion unknown`, async () => {
    const mock = await startMockApi({ mode });
    try {
      const api = new HttpPlantLabClient(
        mock.url,
        mock.key,
        mode === "timeout" ? 20 : 1000,
      );
      await assert.rejects(
        api.diagnose({
          bytes: mock.png,
          mime: "image/png",
          filename: "image.png",
        }),
        (e) => safeError(e).completion_unknown,
      );
      assert.equal(mock.calls.length, 1);
    } finally {
      await mock.close();
    }
  });
test("startup rejects absent key and non-HTTPS remote API without leaking configuration", () => {
  assert.throws(() => new HttpPlantLabClient("https://api.example.test", ""));
  assert.throws(
    () => new HttpPlantLabClient("http://api.example.test", "secret"),
  );
  assert.throws(
    () =>
      new HttpPlantLabClient("https://user:secret@api.example.test", "secret"),
  );
});

test("separate client instances send only their own account credential", async () => {
  const a = await startMockApi();
  const b = await startMockApi();
  try {
    await new HttpPlantLabClient(a.url, a.key).usage();
    await new HttpPlantLabClient(b.url, b.key).usage();
    await assert.rejects(new HttpPlantLabClient(a.url, b.key).usage());
    assert.deepEqual(
      a.calls.map((c) => c.keyAccepted),
      [true, false],
    );
    assert.deepEqual(
      b.calls.map((c) => c.keyAccepted),
      [true],
    );
  } finally {
    await a.close();
    await b.close();
  }
});
