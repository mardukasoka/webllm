import { describe, expect, it } from "vitest";
import {
  createMultiExperiment,
  getMultiExperiment,
  multiExperimentStatus,
  observeMultiExperiment,
} from "../atlas-mcp/src/multi-experiments.ts";

function createFixture(id) {
  return createMultiExperiment({
    experimentId: id,
    goal: "Evaluate a bounded Council change across software and scientific evidence",
    hypothesis: "The candidate improves required quality metrics without regressions",
    sourceCommit: "abc123",
    metrics: [
      { metric: "test_pass_rate", direction: "maximize", baseline: 0.9, minimumDelta: 0.05, required: true },
      { metric: "lint_error_count", direction: "minimize", baseline: 2, minimumDelta: 2, required: true },
      { metric: "wolfram_verification_score", direction: "maximize", baseline: 0, minimumDelta: 1, required: false },
    ],
  });
}

describe("multi-metric experiments", () => {
  it("stays inconclusive until all required metrics are observed", () => {
    const id = `multi-${Date.now()}-pending`;
    const created = createFixture(id);
    expect(created.overallDisposition).toBe("inconclusive");
    expect(created.observedMetricCount).toBe(0);

    const afterTest = observeMultiExperiment({
      experimentId: id,
      metric: "test_pass_rate",
      observed: 0.96,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-test", sourceId: "task-1" },
    });
    expect(afterTest.observations[0]).toMatchObject({
      metric: "test_pass_rate",
      disposition: "keep",
    });
    expect(afterTest.overallDisposition).toBe("inconclusive");
  });

  it("keeps only when all required metrics meet threshold", () => {
    const id = `multi-${Date.now()}-keep`;
    createFixture(id);
    observeMultiExperiment({
      experimentId: id,
      metric: "test_pass_rate",
      observed: 0.96,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-test" },
    });
    const final = observeMultiExperiment({
      experimentId: id,
      metric: "lint_error_count",
      observed: 0,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-lint" },
    });
    expect(final.overallDisposition).toBe("keep");
  });

  it("rejects immediately when a required metric regresses", () => {
    const id = `multi-${Date.now()}-reject`;
    createFixture(id);
    const result = observeMultiExperiment({
      experimentId: id,
      metric: "lint_error_count",
      observed: 3,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-lint-regression" },
    });
    expect(result.observations[0]).toMatchObject({
      metric: "lint_error_count",
      disposition: "reject",
    });
    expect(result.overallDisposition).toBe("reject");
  });

  it("does not let an optional metric override required metrics", () => {
    const id = `multi-${Date.now()}-optional`;
    createFixture(id);
    observeMultiExperiment({
      experimentId: id,
      metric: "test_pass_rate",
      observed: 0.96,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-test" },
    });
    observeMultiExperiment({
      experimentId: id,
      metric: "lint_error_count",
      observed: 0,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-lint" },
    });
    const result = observeMultiExperiment({
      experimentId: id,
      metric: "wolfram_verification_score",
      observed: 0,
      evidence: { kind: "wolfram-verification", evidenceDigest: "digest-wolfram" },
    });
    expect(result.overallDisposition).toBe("keep");
    expect(result.observations.find((item) => item.metric === "wolfram_verification_score").disposition).toBe("keep");
  });

  it("rejects duplicate metric definitions and repeated observations", () => {
    const duplicateId = `multi-${Date.now()}-dupe-definition`;
    expect(() => createMultiExperiment({
      experimentId: duplicateId,
      goal: "Duplicate metric test",
      hypothesis: "Duplicate names are invalid",
      sourceCommit: "def456",
      metrics: [
        { metric: "score", direction: "maximize", baseline: 0, minimumDelta: 0, required: true },
        { metric: "score", direction: "minimize", baseline: 1, minimumDelta: 0, required: true },
      ],
    })).toThrow(/unique names/);

    const id = `multi-${Date.now()}-dupe-observation`;
    createFixture(id);
    const input = {
      experimentId: id,
      metric: "test_pass_rate",
      observed: 0.96,
      evidence: { kind: "repository-metric", evidenceDigest: "digest-test" },
    };
    observeMultiExperiment(input);
    expect(() => observeMultiExperiment(input)).toThrow(/already been observed/);
  });

  it("reports a bounded non-writing multi-metric capability", () => {
    expect(multiExperimentStatus()).toMatchObject({
      supported: true,
      persistence: "in-memory",
      execution: "external",
      writes: false,
      maxMetricsPerExperiment: 12,
    });
    expect(getMultiExperiment(`multi-${Date.now()}-missing`)).toBeDefined;
  });
});
