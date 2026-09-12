import { describe, expect, it } from "vitest";
import { createMultiExperiment, getMultiExperiment, observeMultiExperiment } from "../atlas-mcp/src/multi-experiments.ts";
import { observeMultiExperimentFromWolfram } from "../atlas-mcp/src/multi-wolfram-verification.ts";
import { observeMultiExperimentFromComparison } from "../atlas-mcp/src/multi-comparison-experiment.ts";
import { compareMultiExperimentCandidates } from "../atlas-mcp/src/multi-candidate-comparison.ts";
import {
  exportMultiExperimentSnapshot,
  importMultiExperimentSnapshot,
  multiExperimentSnapshotLimits,
} from "../atlas-mcp/src/multi-experiment-snapshot.ts";
import { experimentOrchestratorLimits } from "../atlas-mcp/src/experiment-orchestrator.ts";

function createCandidate(id, sourceCommit) {
  return createMultiExperiment({
    experimentId: id,
    goal: "Evaluate one candidate across software and scientific evidence",
    hypothesis: "Required metrics do not regress",
    sourceCommit,
    metrics: [
      { metric: "test_pass_rate", direction: "maximize", baseline: 0.9, minimumDelta: 0.05, required: true },
      { metric: "wolfram_verification_score", direction: "maximize", baseline: 0, minimumDelta: 1, required: true },
      { metric: "council_alignment", direction: "maximize", baseline: 0, minimumDelta: 0.5, required: false },
    ],
  });
}

describe("completed multi-metric integration", () => {
  it("attaches Wolfram verification deterministically", () => {
    const id = `multi-wolfram-${Date.now()}`;
    createCandidate(id, "commit-wolfram");
    const result = observeMultiExperimentFromWolfram({
      experimentId: id,
      metric: "wolfram_verification_score",
      wolfram: {
        mode: "wolfram-language",
        operation: "physics",
        query: "Verify E=m c^2 for m=1 kg",
        computation: "Quantity[1,\"Kilograms\"] Quantity[1,\"SpeedOfLight\"]^2",
        result: "89875517873681764 joules",
        verified: true,
      },
    });

    const observation = result.observations.find((item) => item.metric === "wolfram_verification_score");
    expect(observation).toMatchObject({ observed: 1, disposition: "keep" });
    expect(observation.evidence.kind).toBe("wolfram-verification");
    expect(observation.evidence.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps Council-derived observations explicit and non-voting", () => {
    const id = `multi-council-${Date.now()}`;
    createCandidate(id, "commit-council");
    const result = observeMultiExperimentFromComparison({
      experimentId: id,
      metric: "council_alignment",
      observed: 0.75,
      derivation: "Three of four proposals share the same bounded test recommendation; no ranking applied.",
      comparison: {
        ok: true,
        status: "compared",
        reviewId: "review-1",
        evidenceDigest: "digest-review-1",
        participantCount: 4,
        agreements: { sharedPaths: ["app.js"], sharedTests: ["npm test"], allApplyRequestedFalse: true },
        disagreements: { paths: [], tests: [], confidence: ["medium", "high"] },
      },
    });

    expect(result.observations.find((item) => item.metric === "council_alignment")).toMatchObject({
      observed: 0.75,
      disposition: "keep",
    });
    expect(result.limitations.join(" ")).toMatch(/does not rank, vote, or select/i);
  });

  it("compares identical candidate metric bundles without selecting a winner", () => {
    const suffix = Date.now();
    const a = `candidate-a-${suffix}`;
    const b = `candidate-b-${suffix}`;
    createCandidate(a, "commit-a");
    createCandidate(b, "commit-b");
    observeMultiExperiment({
      experimentId: a,
      metric: "test_pass_rate",
      observed: 0.96,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-a" },
    });
    observeMultiExperiment({
      experimentId: b,
      metric: "test_pass_rate",
      observed: 0.95,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-b" },
    });

    const comparison = compareMultiExperimentCandidates({ experimentIds: [a, b] });
    expect(comparison.status).toBe("compared");
    expect(comparison.candidateCount).toBe(2);
    expect(comparison.metrics.find((metric) => metric.metric === "test_pass_rate").candidates).toHaveLength(2);
    expect(comparison).not.toHaveProperty("winner");
    expect(comparison).not.toHaveProperty("ranking");
  });

  it("exports portable state and imports absent experiment ids", () => {
    const sourceId = `snapshot-source-${Date.now()}`;
    createMultiExperiment({
      experimentId: sourceId,
      goal: "Snapshot source",
      hypothesis: "State can be serialized",
      sourceCommit: "snapshot-commit",
      metrics: [{ metric: "score", direction: "maximize", baseline: 0, minimumDelta: 1, required: true }],
    });
    observeMultiExperiment({
      experimentId: sourceId,
      metric: "score",
      observed: 1,
      evidence: { kind: "external", evidenceDigest: "snapshot-digest" },
    });

    const exported = exportMultiExperimentSnapshot();
    const source = exported.experiments.find((item) => item.experimentId === sourceId);
    expect(source).toBeDefined();

    const importedId = `${sourceId}-copy`;
    const imported = importMultiExperimentSnapshot({
      version: 1,
      experiments: [{ ...source, experimentId: importedId }],
    });
    expect(imported).toMatchObject({ count: 1, writes: false });
    expect(getMultiExperiment(importedId)).toMatchObject({
      experimentId: importedId,
      overallDisposition: "keep",
    });
    expect(multiExperimentSnapshotLimits()).toMatchObject({ filesystemWrites: false, duplicatePolicy: "reject" });
  });

  it("advertises a read-only bounded repository orchestrator", () => {
    expect(experimentOrchestratorLimits()).toMatchObject({
      repository: "webllm",
      writeMode: "read-only",
      execution: "existing-allowlisted-task-only",
      writes: false,
    });
    expect(experimentOrchestratorLimits().supportedMetrics).toEqual(expect.arrayContaining([
      "test_pass_rate",
      "test_failure_count",
      "lint_error_count",
      "typecheck_error_count",
    ]));
  });
});
