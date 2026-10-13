import { AdapterError } from "./errors.js";
import type { Photo } from "./files.js";
export interface PlantLabClient {
  info(): Promise<unknown>;
  usage(): Promise<unknown>;
  diagnose(photo: Photo): Promise<unknown>;
}
export class HttpPlantLabClient implements PlantLabClient {
  private readonly base: URL;
  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 30_000,
  ) {
    this.base = new URL(baseUrl);
    const local =
      this.base.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(this.base.hostname);
    if (
      (this.base.protocol !== "https:" && !local) ||
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      this.base.pathname !== "/" ||
      !apiKey.trim() ||
      /[\r\n]/.test(apiKey)
    )
      throw new AdapterError(
        "CONFIGURATION",
        "Set a valid API URL and API key through the server environment.",
      );
  }
  info() {
    return this.call("/info");
  }
  usage() {
    return this.call("/usage");
  }
  diagnose(photo: Photo) {
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(photo.bytes)], { type: photo.mime }),
      photo.filename,
    );
    return this.call("/diagnose", form);
  }
  private async call(path: string, body?: FormData): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const diagnosis = body !== undefined;
    try {
      const response = await fetch(new URL(path, this.base), {
        method: diagnosis ? "POST" : "GET",
        headers: { "X-API-Key": this.apiKey, accept: "application/json" },
        body,
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 401 || response.status === 403)
          throw new AdapterError(
            "ACCOUNT_UNAVAILABLE",
            "PlantLab account access is unavailable.",
          );
        if (response.status === 429)
          throw new AdapterError(
            "QUOTA_EXCEEDED",
            "The account allowance or request limit is exhausted. Wait before a deliberate new request.",
          );
        if (diagnosis && response.status >= 500)
          throw new AdapterError(
            "COMPLETION_UNKNOWN",
            "Diagnosis completion is unknown. Do not retry automatically.",
            true,
          );
        throw new AdapterError(
          "UPSTREAM_UNAVAILABLE",
          "PlantLab could not complete the request.",
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw Error("Empty response");
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 1024 * 1024) throw Error("Response limit");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch (error) {
      if (error instanceof AdapterError) throw error;
      throw new AdapterError(
        diagnosis ? "COMPLETION_UNKNOWN" : "UPSTREAM_UNAVAILABLE",
        diagnosis
          ? "Diagnosis completion is unknown. Do not retry automatically."
          : "PlantLab is unavailable.",
        diagnosis,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
