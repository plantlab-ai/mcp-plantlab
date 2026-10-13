import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
import sharp from "sharp";
import { AdapterError } from "./errors.js";
import { fileSchema, type FileReference } from "./schemas.js";
export const MAX_PHOTO_BYTES = 9 * 1024 * 1024;
export const MAX_DIMENSION = 8192;
export const MAX_PIXELS = 50_000_000;
export interface Photo {
  bytes: Buffer;
  mime: "image/jpeg" | "image/png";
  filename: string;
}
export interface PhotoSource {
  download(file: FileReference): Promise<Photo>;
}
export interface Address {
  address: string;
  family: number;
}
interface DownloadResponse {
  status: number;
  headers: Record<string, string | undefined>;
  body: AsyncIterable<Uint8Array>;
  close?: () => void;
}
interface DownloadDependencies {
  resolve?: (host: string) => Promise<Address[]>;
  request?: (
    url: URL,
    address: Address,
    signal: AbortSignal,
  ) => Promise<DownloadResponse>;
  timeoutMs?: number;
}
export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}
export async function validatePhoto(bytes: Buffer): Promise<Photo> {
  if (bytes.length > MAX_PHOTO_BYTES)
    throw new AdapterError(
      "IMAGE_TOO_LARGE",
      "Use a JPEG or PNG photo at most 9 MiB.",
    );
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg)
    throw new AdapterError(
      "INVALID_IMAGE",
      "Use a valid JPEG or PNG photo at most 9 MiB.",
    );
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      failOn: "warning",
      animated: false,
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > MAX_DIMENSION ||
      metadata.height > MAX_DIMENSION ||
      (metadata.pages ?? 1) > 1 ||
      metadata.width * metadata.height > MAX_PIXELS
    )
      throw Error("Image limits");
    await image.timeout({ seconds: 5 }).stats();
    return {
      bytes,
      mime: png ? "image/png" : "image/jpeg",
      filename: png ? "image.png" : "image.jpg",
    };
  } catch {
    throw new AdapterError(
      "INVALID_IMAGE",
      "Use a complete JPEG or PNG with dimensions at most 8192 pixels and at most 50 million pixels.",
    );
  }
}
export function requestPinned(
  url: URL,
  address: Address,
  signal: AbortSignal,
): Promise<DownloadResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        signal,
        agent: false,
        family: address.family,
        headers: {
          accept: "image/jpeg, image/png",
          "accept-encoding": "identity",
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: {
            "content-length": res.headers["content-length"],
            "content-encoding": String(
              res.headers["content-encoding"] ?? "identity",
            ),
          },
          body: res,
          close: () => res.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
export class FileDownloader implements PhotoSource {
  private readonly origins: Set<string>;
  constructor(
    origins: string[],
    private readonly dependencies: DownloadDependencies = {},
  ) {
    this.origins = new Set(
      origins.map((origin) => {
        const u = new URL(origin);
        if (
          u.protocol !== "https:" ||
          u.username ||
          u.password ||
          u.pathname !== "/" ||
          u.search ||
          u.hash
        )
          throw new AdapterError(
            "CONFIGURATION",
            "File origins must be HTTPS origins.",
          );
        return u.origin;
      }),
    );
  }
  async download(file: FileReference): Promise<Photo> {
    const parsed = fileSchema.safeParse(file);
    if (!parsed.success)
      throw new AdapterError(
        "INVALID_FILE",
        "Select a photo with a valid file reference.",
      );
    const url = new URL(parsed.data.download_url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !this.origins.has(url.origin)
    )
      throw new AdapterError(
        "FILE_DESTINATION",
        "The file destination is not allowed.",
      );
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.dependencies.timeoutMs ?? 15_000,
    );
    let response: DownloadResponse | undefined;
    const aborted = new Promise<never>((_resolve, reject) =>
      controller.signal.addEventListener(
        "abort",
        () =>
          reject(
            new AdapterError(
              "FILE_UNAVAILABLE",
              "File download failed. Select the photo again.",
            ),
          ),
        { once: true },
      ),
    );
    try {
      const operation = (async () => {
        const addresses = await (
          this.dependencies.resolve ?? ((host) => lookup(host, { all: true }))
        )(url.hostname.replace(/^\[|\]$/g, ""));
        if (controller.signal.aborted) throw Error("Deadline");
        if (
          !addresses.length ||
          addresses.some((a) => !isPublicAddress(a.address))
        )
          throw new AdapterError(
            "FILE_DESTINATION",
            "The file destination is not allowed.",
          );
        response = await (this.dependencies.request ?? requestPinned)(
          url,
          addresses[0]!,
          controller.signal,
        );
        if (response.status !== 200)
          throw new AdapterError(
            "FILE_UNAVAILABLE",
            "File reference is unavailable or expired. Select the photo again. Redirects are not accepted.",
          );
        const encoding = response.headers["content-encoding"];
        if (encoding && encoding !== "identity")
          throw new AdapterError(
            "INVALID_IMAGE",
            "Compressed file transfers are not accepted. Use JPEG or PNG.",
          );
        const length = response.headers["content-length"];
        if (
          length &&
          (!/^\d+$/.test(length) || Number(length) > MAX_PHOTO_BYTES)
        )
          throw new AdapterError(
            "IMAGE_TOO_LARGE",
            "Use a JPEG or PNG photo at most 9 MiB.",
          );
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of response.body) {
          if (controller.signal.aborted) throw Error("Deadline");
          total += chunk.length;
          if (total > MAX_PHOTO_BYTES)
            throw new AdapterError(
              "IMAGE_TOO_LARGE",
              "Use a JPEG or PNG photo at most 9 MiB.",
            );
          chunks.push(Buffer.from(chunk));
        }
        return validatePhoto(Buffer.concat(chunks, total));
      })();
      return await Promise.race([operation, aborted]);
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError(
        "FILE_UNAVAILABLE",
        "File download failed. Select the photo again.",
      );
    } finally {
      clearTimeout(timer);
      controller.abort();
      response?.close?.();
    }
  }
}
