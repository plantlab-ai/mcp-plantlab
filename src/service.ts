import { z } from "zod";
import type { PlantLabClient } from "./client.js";
import { AdapterError } from "./errors.js";
import {
  MAX_PHOTO_BYTES,
  MAX_DIMENSION,
  MAX_PIXELS,
  type PhotoSource,
} from "./files.js";
import {
  fileSchema,
  mapDiagnosis,
  mapUsage,
  supportedSchema,
  type FileReference,
} from "./schemas.js";
export class ToolService {
  private readonly active = new Map<
    string,
    Promise<ReturnType<typeof mapDiagnosis>>
  >();
  constructor(
    private readonly api: PlantLabClient,
    private readonly files: PhotoSource,
  ) {}
  async supported() {
    const info = z
      .object({
        capabilities: z.object({
          image_formats: z.array(z.string()),
          max_file_size_mb: z.number().positive(),
        }),
      })
      .safeParse(await this.api.info());
    if (!info.success)
      throw new AdapterError(
        "INVALID_RESPONSE",
        "PlantLab capabilities are unavailable.",
      );
    return supportedSchema.parse({
      species: [
        {
          id: "cannabis",
          name: "Cannabis sativa",
          diagnoses: ["plant health", "growth stage", "conditions", "pests"],
        },
        {
          id: "tomato",
          name: "Solanum lycopersicum",
          diagnoses: [
            "plant health",
            "early_blight",
            "late_blight",
            "leaf_mold",
            "septoria",
            "bacterial_spot",
            "leaf_curl_virus",
            "mosaic_virus",
            "target_spot",
            "spider_mites",
          ],
        },
      ],
      image_formats: info.data.capabilities.image_formats.filter((f) =>
        ["jpg", "jpeg", "png"].includes(f.toLowerCase()),
      ),
      max_photo_bytes: Math.min(
        MAX_PHOTO_BYTES,
        Math.max(
          0,
          Math.floor(info.data.capabilities.max_file_size_mb * 1024 * 1024) -
            1024 * 1024,
        ),
      ),
      max_dimension: MAX_DIMENSION,
      max_pixels: MAX_PIXELS,
      input_scope:
        "Whole plant, leaves, or flowers with visible plant structure. One species per photo. Unknown species remains out of scope.",
      contract_source: "https://plantlab.ai/agent-reference.md",
      capabilities_source:
        "Species and diagnoses use the public contract snapshot from 2026-10-13. Format and body limits use the configured API /info response.",
    });
  }
  async usage() {
    return mapUsage(await this.api.usage());
  }
  diagnose(file: FileReference) {
    const parsed = fileSchema.safeParse(file);
    if (!parsed.success)
      return Promise.reject(
        new AdapterError(
          "INVALID_FILE",
          "Select a photo with a valid file reference.",
        ),
      );
    const existing = this.active.get(parsed.data.file_id);
    if (existing) return existing;
    if (this.active.size >= 4)
      return Promise.reject(
        new AdapterError(
          "BUSY",
          "Four photos are already active. Wait before another request.",
        ),
      );
    const operation = (async () => {
      const photo = await this.files.download(parsed.data);
      return mapDiagnosis(await this.api.diagnose(photo));
    })();
    this.active.set(parsed.data.file_id, operation);
    void operation
      .finally(() => this.active.delete(parsed.data.file_id))
      .catch(() => {});
    return operation;
  }
}
