import { describe, expect, it } from "vitest";
import {
  createExperiment,
  evaluateStoredExperiment,
  getExperiment,
  listExperiments,
} from "../atlas-mcp/src/experiments.ts";

describe("Atlas MCP experiment store", () => {
  it("plans and evaluates a measurable experiment without executing work", () => {
    const id = `exp-${Date.now()}-keep`;
    const planned = createExperiment({
      experimentId: id,
      goal: "Improve factual validation score",
      hypothesis: "A bounded verifier improves the score",
      metric: "validation_score",
      direction: "maximize",
      baseline: 0.8,
      minimumDelta: 0.05,
      sourceCommit: "abc123",
      parameters: { verifier: "bounded" },
    });

    expect(planned).toMatchObject({ status: "planned", execution: "external", writes: false });

    const evaluated = evaluateStoredExperiment({
      experimentId: id,
      status: "completed",
      observed: 0.87,
    });

    expect(evaluated.disposition).toBe("keep");
    expect(getExperiment(id).disposition).toBe("keep");
  });

  it("records incomplete work as inconclusive and prevents reevaluation", () => {
    const id = `exp-${Date.now()}-incomplete`;
    createExperiment({
      experimentId: id,
      goal: "Reduce latency",
      hypothesis: "A smaller model lowers latency",
      metric: "latency_ms",
      direction: "minimize",
      baseline: 1000,
      minimumDelta: 50,
      sourceCommit: "def456",
    });

    const evaluated = evaluateStoredExperiment({
      experimentId: id,
      status: "failed",
      reason: "Provider unavailable",
    });
    expect(evaluated.disposition).toBe("inconclusive");
    expect(() => evaluateStoredExperiment({ experimentId: id, status: "completed", observed: 800 })).toThrow(/already been evaluated/);
  });

  it("lists plans and rejects unknown experiment ids", () => {
    expect(Array.isArray(listExperiments())).toBe(true);
    expect(() => getExperiment("definitely-not-an-experiment")).toThrow(/Unknown experiment id/);
  });
});
