import { describe, expect, it } from "vitest";
import { createExperiment, getExperiment } from "../atlas-mcp/src/experiments.ts";
import {
  evaluateExperimentFromWolfram,
  wolframVerificationLimits,
} from "../atlas-mcp/src/wolfram-verification.ts";

describe("Wolfram experiment verification", () => {
  it("derives a verified observation of 1 and records bounded provenance", () => {
    const id = `wolfram-${Date.now()}-verified`;
    createExperiment({
      experimentId: id,
      goal: "Verify a physical calculation",
      hypothesis: "Wolfram independently confirms the claim",
      metric: "wolfram_verification_score",
      direction: "maximize",
      baseline: 0,
      minimumDelta: 1,
      sourceCommit: "abc123",
    });

    const result = evaluateExperimentFromWolfram({
      experimentId: id,
      metric: "wolfram_verification_score",
      wolfram: {
        mode: "wolfram-language",
        operation: "physics",
        query: "Verify E = m c^2 for m = 1 kg",
        computation: "Quantity[1, \"Kilograms\"] Quantity[1, \"SpeedOfLight\"]^2",
        result: "8.9875517873681764*^16 joules",
        verified: true,
      },
    });

    expect(result.observed).toBe(1);
    expect(result.disposition).toBe("keep");
    expect(result.evidence).toMatchObject({
      kind: "wolfram-verification",
      verified: true,
      operation: "physics",
      observed: 1,
    });
    expect(result.evidence.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(getExperiment(id).evidence.evidenceDigest).toBe(result.evidence.evidenceDigest);
  });

  it("derives a contradicted observation of 0", () => {
    const id = `wolfram-${Date.now()}-contradicted`;
    createExperiment({
      experimentId: id,
      goal: "Check an equation claim",
      hypothesis: "The proposed identity is correct",
      metric: "wolfram_verification_score",
      direction: "maximize",
      baseline: 1,
      minimumDelta: 0,
      sourceCommit: "def456",
    });

    const result = evaluateExperimentFromWolfram({
      experimentId: id,
      metric: "wolfram_verification_score",
      wolfram: {
        mode: "wolfram",
        operation: "equation",
        query: "Is (a+b)^2 = a^2+b^2?",
        computation: "FullSimplify[(a+b)^2 == a^2+b^2]",
        result: "False",
        verified: false,
      },
    });

    expect(result.observed).toBe(0);
    expect(result.disposition).toBe("reject");
  });

  it("rejects metric mismatches instead of attaching evidence", () => {
    const id = `wolfram-${Date.now()}-metric`;
    createExperiment({
      experimentId: id,
      goal: "Check units",
      hypothesis: "Dimensions match",
      metric: "unit_verification_score",
      direction: "maximize",
      baseline: 0,
      minimumDelta: 1,
      sourceCommit: "ghi789",
    });

    expect(() => evaluateExperimentFromWolfram({
      experimentId: id,
      metric: "different_metric",
      wolfram: {
        mode: "wolfram-alpha",
        operation: "units",
        query: "1 meter in centimeters",
        computation: "1 m -> cm",
        result: "100 centimeters",
        verified: true,
      },
    })).toThrow(/does not match experiment metric/);

    expect(getExperiment(id).status).toBe("planned");
  });

  it("advertises an external, non-writing verifier boundary", () => {
    expect(wolframVerificationLimits()).toMatchObject({
      metricRange: [0, 1],
      execution: "external-wolfram-mcp",
      writes: false,
    });
  });
});
