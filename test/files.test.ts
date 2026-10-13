import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import {
  FileDownloader,
  isPublicAddress,
  validatePhoto,
  MAX_PHOTO_BYTES,
} from "../src/files.js";
const reference = {
  file_id: "fixture",
  download_url: "https://files.example.test/photo?signature=private",
};
const png = () =>
  sharp({ create: { width: 2, height: 2, channels: 3, background: "green" } })
    .png()
    .toBuffer();
test("rejects private and special network ranges including mapped IPv6", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "198.18.0.1",
    "192.0.2.1",
  ])
    assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});
test("accepts JPEG and PNG bytes without optional file metadata", async () => {
  const p = await validatePhoto(await png());
  assert.equal(p.mime, "image/png");
  assert.equal(p.filename, "image.png");
  const j = await validatePhoto(
    await sharp(await png())
      .jpeg()
      .toBuffer(),
  );
  assert.equal(j.mime, "image/jpeg");
});
test("rejects corrupt, HEIC, oversize and excessive dimension images", async () => {
  await assert.rejects(validatePhoto(Buffer.from("HEIC data")));
  await assert.rejects(validatePhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1)));
  await assert.rejects(
    validatePhoto(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  await assert.rejects(
    validatePhoto(
      await sharp({
        create: { width: 8193, height: 1, channels: 3, background: "green" },
      })
        .png()
        .toBuffer(),
    ),
  );
});
test("requires exact allowed HTTPS origin, no userinfo, and public DNS before connection", async () => {
  let calls = 0;
  const downloader = new FileDownloader(["https://files.example.test"], {
    resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    request: async () => {
      calls++;
      throw Error("must not connect");
    },
  });
  for (const url of [
    "http://files.example.test/photo",
    "https://evil.example.test/photo",
    "https://user:secret@files.example.test/photo",
    reference.download_url,
  ])
    await assert.rejects(
      downloader.download({ ...reference, download_url: url }),
    );
  assert.equal(calls, 0);
});
test("pins resolved address and ignores claimed MIME and original filename", async () => {
  const bytes = await png();
  const downloader = new FileDownloader(["https://files.example.test"], {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    request: async (_url, address) => {
      assert.equal(address.address, "8.8.8.8");
      return {
        status: 200,
        headers: {},
        body: (async function* () {
          yield bytes;
        })(),
      };
    },
  });
  assert.equal(
    (
      await downloader.download({
        ...reference,
        mime_type: "text/plain",
        file_name: "../../secret",
      })
    ).filename,
    "image.png",
  );
});
test("rejects all redirects and expired references without following them", async () => {
  for (const status of [301, 302, 307, 401, 403, 404, 410]) {
    let calls = 0;
    const d = new FileDownloader(["https://files.example.test"], {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => {
        calls++;
        return {
          status,
          headers: { location: "http://127.0.0.1/" },
          body: (async function* () {})(),
        };
      },
    });
    await assert.rejects(d.download(reference));
    assert.equal(calls, 1);
  }
});
test("caps declared and streamed bytes and rejects compressed responses", async () => {
  for (const headers of [
    { "content-length": String(MAX_PHOTO_BYTES + 1) },
    { "content-encoding": "gzip" },
    {},
  ]) {
    const d = new FileDownloader(["https://files.example.test"], {
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async () => ({
        status: 200,
        headers,
        body: (async function* () {
          yield Buffer.alloc(MAX_PHOTO_BYTES + 1);
        })(),
      }),
    });
    await assert.rejects(d.download(reference));
  }
});
test("bounds DNS and slow body duration", async () => {
  const d = new FileDownloader(["https://files.example.test"], {
    resolve: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  await assert.rejects(d.download(reference), /File download failed/);
});

test("production pinned lookup reaches a local socket with Node 22 family selection", async () => {
  const { createServer } = await import("node:http");
  const { requestPinned } = await import("../src/files.js");
  const server = createServer();
  let connected = false;
  server.on("connection", () => {
    connected = true;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    // TLS sent to this plain HTTP fixture must fail after the pinned TCP connection.
    await assert.rejects(
      requestPinned(
        new URL(`https://files.example.test:${address.port}/photo`),
        { address: "127.0.0.1", family: 4 },
        AbortSignal.timeout(1000),
      ),
      (error: unknown) => (error as { code: string }).code === "EPROTO",
    );
    assert.equal(connected, true);
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

test("rejects mixed public/private DNS responses and public mapped IPv6 conservatively", async () => {
  let requests = 0;
  const d = new FileDownloader(["https://files.example.test"], {
    resolve: async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
    request: async () => {
      requests++;
      throw Error("Forbidden");
    },
  });
  await assert.rejects(d.download(reference));
  assert.equal(requests, 0);
  assert.equal(isPublicAddress("::ffff:8.8.8.8"), false);
});
test("rejects more than 50 million decoded pixels", async () => {
  const bytes = await sharp({
    create: { width: 7500, height: 7000, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  await assert.rejects(validatePhoto(bytes));
});
test("caps a stalled response stream with the total download deadline", async () => {
  const d = new FileDownloader(["https://files.example.test"], {
    resolve: async () => [{ address: "8.8.8.8", family: 4 }],
    timeoutMs: 20,
    request: async () => ({
      status: 200,
      headers: {},
      body: (async function* () {
        yield Buffer.from("partial");
        await new Promise(() => {});
      })(),
    }),
  });
  await assert.rejects(d.download(reference), /File download failed/);
});
