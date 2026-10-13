import { z } from "zod";
import { AdapterError } from "./errors.js";
const probability = z.number().min(0).max(1);
const text = z.string().max(2000);
const strings = z.array(text).max(100);
export const fileSchema = z
  .object({
    download_url: z.string().url().max(8192),
    file_id: z.string().min(1).max(256),
    mime_type: z.string().max(100).optional(),
    file_name: z.string().max(256).optional(),
  })
  .strict();
export type FileReference = z.infer<typeof fileSchema>;
const finding = z.object({
  class_id: text,
  display_name: text.optional(),
  confidence: probability,
  suspected: z.boolean().optional(),
  coarse_group: text.optional(),
});
export const diagnosisSchema = z.object({
  success: z.literal(true),
  species: text.nullable(),
  species_name: text.nullable(),
  species_confidence: probability.nullable(),
  in_scope: z.boolean(),
  routed_reason: text.nullable(),
  results: z
    .array(
      z.object({
        bbox: z.object({
          x0: probability,
          y0: probability,
          x1: probability,
          y1: probability,
          normalized: z.literal(true),
        }),
        is_healthy: z.boolean().optional(),
        health_confidence: probability.optional(),
        growth_stage: text.optional(),
        growth_stage_confidence: probability.optional(),
        conditions: z.array(finding).max(100).optional(),
        pests: z.array(finding).max(100).optional(),
        reliability_score: probability.optional(),
        coarse_fallback: text.optional(),
        uncertainty_factors: strings.optional(),
        mulders_hypotheses: z
          .array(
            z.object({
              excess: text.optional(),
              explains: strings.optional(),
              evidence: z.number().optional(),
              evidence_count: z.number().int().optional(),
            }),
          )
          .max(100)
          .optional(),
        environmental_patterns: z
          .array(
            z.object({ pattern: text, trigger: strings, hypothesis: text }),
          )
          .max(100)
          .optional(),
        progression_risks: z
          .array(z.object({ confirmed: text, risk: text, mechanism: text }))
          .max(100)
          .optional(),
        stage_advisories: z
          .array(z.object({ class_id: text, stage: text, advisory: text }))
          .max(100)
          .optional(),
      }),
    )
    .max(100),
});
const period = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  resets_at: text,
});
export const usageSchema = z.object({
  success: z.literal(true),
  usage: z.object({ daily: period, monthly: period }),
});
export const supportedSchema = z.object({
  species: z.array(z.object({ id: text, name: text, diagnoses: strings })),
  image_formats: strings,
  max_photo_bytes: z.number().int(),
  max_dimension: z.number().int(),
  max_pixels: z.number().int(),
  input_scope: text,
  contract_source: text,
  capabilities_source: text,
});
export const errorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: text,
    message: text,
    completion_unknown: z.boolean(),
  }),
});
export const outputSchema = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  z.union([schema, errorSchema]);
export function mapDiagnosis(value: unknown) {
  const result = diagnosisSchema.safeParse(value);
  if (!result.success)
    throw new AdapterError(
      "COMPLETION_UNKNOWN",
      "Diagnosis completion is unknown. Do not retry automatically.",
      true,
    );
  return result.data;
}
export function mapUsage(value: unknown) {
  const result = usageSchema.safeParse(value);
  if (!result.success)
    throw new AdapterError("INVALID_RESPONSE", "Usage data is unavailable.");
  return result.data;
}
