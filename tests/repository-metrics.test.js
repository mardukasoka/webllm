import { describe, expect, it } from "vitest";
import {
  deriveRepositoryMetric,
  repositoryMetricLimits,
} from "../atlas-mcp/src/repository-metrics.ts";

describe("repository experiment metrics", () => {
  it("derives Vitest pass rate and failure count", () => {
    const fixture = {
      taskType: "test",
      taskStatus: "failed",
      exitCode: 1,
      timedOut: false,
      stdout: "Tests  1 failed | 19 passed (20)",
      stderr: "",
    };

    expect(deriveRepositoryMetric({ ...fixture, metric: "test_pass_rate" })).toMatchObject({
      observed: 0.95,
      passed: 19,
      failed: 1,
    });
    expect(deriveRepositoryMetric({ ...fixture, metric: "test_failure_count" }).observed).toBe(1);
  });

  it("derives zero lint errors from a successful lint task", () => {
    const result = deriveRepositoryMetric({
      metric: "lint_error_count",
      taskType: "lint",
      taskStatus: "completed",
      exitCode: 0,
      timedOut: false,
      stdout: "",
      stderr: "",
    });
    expect(result.observed).toBe(0);
  });

  it("parses an ESLint error summary", () => {
    const result = deriveRepositoryMetric({
      metric: "lint_error_count",
      taskType: "lint",
      taskStatus: "failed",
      exitCode: 1,
      timedOut: false,
      stdout: "✖ 12 problems (7 errors, 5 warnings)",
      stderr: "",
    });
    expect(result.observed).toBe(7);
  });

  it("derives TypeScript error counts from bounded compiler output", () => {
    const success = deriveRepositoryMetric({
      metric: "typecheck_error_count",
      taskType: "typecheck",
      taskStatus: "completed",
      exitCode: 0,
      timedOut: false,
      stdout: "",
      stderr: "",
    });
    const failure = deriveRepositoryMetric({
      metric: "typecheck_error_count",
      taskType: "typecheck",
      taskStatus: "failed",
      exitCode: 2,
      timedOut: false,
      stdout: [
        "src/a.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/b.ts(2,3): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      ].join("\n"),
      stderr: "",
    });

    expect(success.observed).toBe(0);
    expect(failure.observed).toBe(2);
  });

  it("derives task success deterministically", () => {
    const success = deriveRepositoryMetric({
      metric: "task_success_score",
      taskType: "audit",
      taskStatus: "completed",
      exitCode: 0,
      timedOut: false,
      stdout: "ok",
      stderr: "",
    });
    const failure = deriveRepositoryMetric({
      metric: "task_success_score",
      taskType: "audit",
      taskStatus: "failed",
      exitCode: 1,
      timedOut: false,
      stdout: "",
      stderr: "failed",
    });
    expect(success.observed).toBe(1);
    expect(failure.observed).toBe(0);
  });

  it("rejects mismatched task types and advertises the full bounded metric set", () => {
    expect(() => deriveRepositoryMetric({
      metric: "test_pass_rate",
      taskType: "lint",
      taskStatus: "completed",
      exitCode: 0,
      timedOut: false,
      stdout: "Tests  20 passed (20)",
      stderr: "",
    })).toThrow(/requires a bounded test task/);

    expect(() => deriveRepositoryMetric({
      metric: "typecheck_error_count",
      taskType: "lint",
      taskStatus: "failed",
      exitCode: 1,
      timedOut: false,
      stdout: "src/a.ts(1,1): error TS2322: bad",
      stderr: "",
    })).toThrow(/requires a bounded typecheck task/);

    expect(repositoryMetricLimits()).toMatchObject({
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
