import assert from "node:assert/strict";
import { test } from "node:test";
import { mapDiagnosis, mapUsage } from "../src/schemas.js";
const box = { x0: 0, y0: 0, x1: 1, y1: 1, normalized: true };
const wire = {
  success: true,
  species: "tomato",
  species_name: "Solanum lycopersicum",
  species_confidence: 0.9,
  in_scope: true,
  routed_reason: null,
  results: [
    {
      bbox: box,
      is_healthy: false,
      health_confidence: 0,
      conditions: [
        {
          class_id: "early_blight",
          display_name: "Early blight",
          confidence: 0.4,
          suspected: true,
          coarse_group: "fungal_disease",
        },
      ],
      uncertainty_factors: ["Low confidence"],
      coarse_fallback: "fungal_disease",
    },
  ],
};
test("preserves species, scope, suspected findings, zero confidence and per-plant uncertainty", () => {
  assert.deepEqual(mapDiagnosis(wire), wire);
});
test("never turns missing health or findings into healthy", () => {
  const result = mapDiagnosis({ ...wire, results: [{ bbox: box }] });
  assert.deepEqual(result.results, [{ bbox: box }]);
});
test("strips internal response fields at every allowed boundary", () => {
  const result = mapDiagnosis({
    ...wire,
    request_id: "private",
    stage_times: { private: 1 },
    engine_version: { models: "private" },
    verification: { second_opinion: "private" },
    results: [{ ...wire.results[0], internal: "private" }],
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
});
test("preserves out-of-scope and missing species state", () => {
  assert.deepEqual(
    mapDiagnosis({
      success: true,
      species: null,
      species_name: null,
      species_confidence: null,
      in_scope: false,
      routed_reason: "unknown_species",
      results: [],
    }).results,
    [],
  );
  assert.throws(() => mapDiagnosis({ success: true }));
});
test("maps minimal usage without account or tier information", () => {
  const period = {
    used: 2,
    limit: 3,
    remaining: 1,
    resets_at: "2026-10-14T00:00:00Z",
  };
  assert.deepEqual(
    mapUsage({
      success: true,
      tier: "private",
      usage: { daily: period, monthly: period },
    }),
    { success: true, usage: { daily: period, monthly: period } },
  );
  assert.throws(() => mapUsage({ success: true, usage: {} }));
});

test("preserves all supported per-plant public reasoning fields", () => {
  const plant = {
    bbox: box,
    is_healthy: false,
    growth_stage: "vegetative",
    growth_stage_confidence: 0.8,
    pests: [{ class_id: "spider_mites", confidence: 0.2, suspected: true }],
    reliability_score: 0.3,
    mulders_hypotheses: [
      {
        excess: "example",
        explains: ["example"],
        evidence: 0.2,
        evidence_count: 1,
      },
    ],
    environmental_patterns: [
      { pattern: "example", trigger: ["example"], hypothesis: "example" },
    ],
    progression_risks: [
      { confirmed: "example", risk: "example", mechanism: "example" },
    ],
    stage_advisories: [
      { class_id: "example", stage: "vegetative", advisory: "example" },
    ],
  };
  assert.deepEqual(
    mapDiagnosis({
      ...wire,
      results: [plant, { bbox: box, is_healthy: true, health_confidence: 0.9 }],
    }).results,
    [plant, { bbox: box, is_healthy: true, health_confidence: 0.9 }],
  );
});
