import { describe, expect, it } from "vitest";
import { createMultiExperiment } from "../atlas-mcp/src/multi-experiments.ts";
import {
  deriveMultiRepositoryObservation,
  multiRepositoryMetricLimits,
  observeMultiExperimentFromRepositoryTask,
} from "../atlas-mcp/src/multi-repository-metrics.ts";

describe("multi-metric repository bridge", () => {
  it("derives deterministic observations with bounded provenance", () => {
    const derived = deriveMultiRepositoryObservation({
      metric: "test_pass_rate",
      taskId: "task-1",
      taskType: "test",
      taskStatus: "failed",
      repo: "webllm",
      action: "test",
      exitCode: 1,
      timedOut: false,
      stdout: "Tests  1 failed | 19 passed (20)",
      stderr: "",
    });

    expect(derived.observed).toBe(0.95);
    expect(derived.evidence).toMatchObject({
      kind: "repository-metric",
      taskId: "task-1",
      taskType: "test",
      repo: "webllm",
      action: "test",
      metric: "test_pass_rate",
      observed: 0.95,
      exitCode: 1,
      timedOut: false,
    });
    expect(derived.evidence.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reuses type guards from the deterministic repository parser", () => {
    expect(() => deriveMultiRepositoryObservation({
      metric: "typecheck_error_count",
      taskId: "task-2",
      taskType: "lint",
      taskStatus: "failed",
      repo: "webllm",
      action: "lint",
      exitCode: 1,
      timedOut: false,
      stdout: "src/a.ts(1,1): error TS2322: bad",
      stderr: "",
    })).toThrow(/requires a bounded typecheck task/);
  });

  it("rejects undeclared metrics before attempting task lookup", () => {
    const id = `multi-repo-${Date.now()}-undeclared`;
    createMultiExperiment({
      experimentId: id,
      goal: "Check declared metric boundary",
      hypothesis: "Only declared metrics may be populated",
      sourceCommit: "abc123",
      metrics: [
        { metric: "lint_error_count", direction: "minimize", baseline: 1, minimumDelta: 1, required: true },
      ],
    });

    expect(() => observeMultiExperimentFromRepositoryTask({
      experimentId: id,
      metric: "test_pass_rate",
      repositoryTask: { taskId: "missing-task" },
    })).toThrow(/is not declared/);
  });

  it("advertises an existing-task-only non-writing boundary", () => {
    expect(multiRepositoryMetricLimits()).toMatchObject({
      source: "bounded-agent-task",
      execution: "existing-allowlisted-task-only",
      writes: false,
      supportedMetrics: expect.arrayContaining([
        "test_pass_rate",
        "test_failure_count",
        "lint_error_count",
        "typecheck_error_count",
        "task_success_score",
      ]),
    });
  });
});
