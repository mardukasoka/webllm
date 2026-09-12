import { describe, expect, it } from "vitest";
import {
  appendExperimentRecord,
  createExperimentPlan,
  evaluateExperiment,
} from "../lib/experiment-ledger.js";

function plan(overrides = {}) {
  return createExperimentPlan({
    experimentId: "exp-1",
    goal: "Reduce Council review latency without reducing acceptance quality",
    hypothesis: "A smaller local review model can preserve quality with lower latency",
    metric: "latency_ms",
    direction: "minimize",
    baseline: 1000,
    minimumDelta: 100,
    sourceCommit: "abc123",
    parameters: { runtime: "lfm2" },
    ...overrides,
  });
}

describe("experiment ledger", () => {
  it("keeps a completed experiment that clears the declared threshold", () => {
    const evaluated = evaluateExperiment(plan(), { status: "completed", observed: 850 });
    expect(evaluated.disposition).toBe("keep");
    expect(evaluated.delta).toBe(150);
  });

  it("rejects a regression", () => {
    const evaluated = evaluateExperiment(plan(), { status: "completed", observed: 1100 });
    expect(evaluated.disposition).toBe("reject");
    expect(evaluated.delta).toBe(-100);
  });

  it("marks sub-threshold improvements and incomplete runs inconclusive", () => {
    expect(
      evaluateExperiment(plan(), { status: "completed", observed: 950 }).disposition
    ).toBe("inconclusive");
    expect(
      evaluateExperiment(plan(), { status: "failed", reason: "runner timed out" }).disposition
    ).toBe("inconclusive");
  });

  it("supports maximize metrics", () => {
    const evaluated = evaluateExperiment(
      plan({ direction: "maximize", baseline: 0.8, minimumDelta: 0.05 }),
      { status: "completed", observed: 0.87 }
    );
    expect(evaluated.disposition).toBe("keep");
    expect(evaluated.delta).toBeCloseTo(0.07);
  });

  it("appends immutably and rejects duplicate experiment ids", () => {
    const evaluated = evaluateExperiment(plan(), { status: "completed", observed: 850 });
    const ledger = appendExperimentRecord([], evaluated);
    expect(ledger).toHaveLength(1);
    expect(() => appendExperimentRecord(ledger, evaluated)).toThrow(/already exists/);
  });
});
