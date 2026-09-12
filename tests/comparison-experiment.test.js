import { describe, expect, it } from "vitest";
import { evaluateExperimentFromComparison } from "../atlas-mcp/src/comparison-experiment.ts";
import { createExperiment, getExperiment } from "../atlas-mcp/src/experiments.ts";

function comparison(overrides = {}) {
  return {
    ok: true,
    status: "compared",
    reviewId: "review-compare-1",
    evidenceDigest: "digest-compare-1",
    participantCount: 2,
    agreements: {
      sharedPaths: [],
      sharedTests: ["npm test"],
      allApplyRequestedFalse: true,
    },
    disagreements: {
      paths: ["lib/models.js"],
      tests: [],
      confidence: ["high", "medium"],
    },
    sources: [
      { sourceId: "local-lfm", confidence: "high" },
      { sourceId: "federated:model-a", confidence: "medium" },
    ],
    ...overrides,
  };
}

describe("Council comparison experiment bridge", () => {
  it("records an explicit comparison-derived metric with bounded provenance", () => {
    const id = `exp-${Date.now()}-comparison-keep`;
    createExperiment({
      experimentId: id,
      goal: "Improve verified agreement score",
      hypothesis: "Federated review improves agreement against evidence",
      metric: "verified_agreement_score",
      direction: "maximize",
      baseline: 0.7,
      minimumDelta: 0.05,
      sourceCommit: "abc123",
    });

    const result = evaluateExperimentFromComparison({
      experimentId: id,
      metric: "verified_agreement_score",
      observed: 0.81,
      derivation: "Independent verifier converted bounded agreement checks to a 0-1 score.",
      comparison: comparison(),
    });

    expect(result.disposition).toBe("keep");
    expect(result.evidence).toEqual({
      kind: "council-comparison",
      reviewId: "review-compare-1",
      evidenceDigest: "digest-compare-1",
      metric: "verified_agreement_score",
      observed: 0.81,
      derivation: "Independent verifier converted bounded agreement checks to a 0-1 score.",
      participantCount: 2,
    });
    expect(result).not.toHaveProperty("winner");
    expect(result).not.toHaveProperty("ranking");

    const stored = getExperiment(id);
    expect(stored.evidence.evidenceDigest).toBe("digest-compare-1");
    expect(JSON.stringify(stored)).not.toContain("unifiedDiff");
  });

  it("rejects a comparison metric that does not match the experiment declaration", () => {
    const id = `exp-${Date.now()}-comparison-mismatch`;
    createExperiment({
      experimentId: id,
      goal: "Reduce disagreement",
      hypothesis: "A verifier reduces unresolved disagreement",
      metric: "disagreement_count",
      direction: "minimize",
      baseline: 4,
      minimumDelta: 1,
      sourceCommit: "def456",
    });

    expect(() => evaluateExperimentFromComparison({
      experimentId: id,
      metric: "different_metric",
      observed: 2,
      derivation: "Counted unresolved dimensions.",
      comparison: comparison({ reviewId: "review-compare-2" }),
    })).toThrow(/does not match experiment metric/);

    expect(getExperiment(id).status).toBe("planned");
  });

  it("requires a valid non-voting comparison artifact", () => {
    const id = `exp-${Date.now()}-comparison-invalid`;
    createExperiment({
      experimentId: id,
      goal: "Improve validation",
      hypothesis: "Comparison evidence helps validation",
      metric: "validation_score",
      direction: "maximize",
      baseline: 0.5,
      sourceCommit: "ghi789",
    });

    expect(() => evaluateExperimentFromComparison({
      experimentId: id,
      metric: "validation_score",
      observed: 0.6,
      derivation: "Verifier score.",
      comparison: comparison({ participantCount: 1 }),
    })).toThrow();

    expect(getExperiment(id).status).toBe("planned");
  });
});
