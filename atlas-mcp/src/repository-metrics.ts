import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { getTaskResult, getTaskStatus } from './agents.js';
import { attachExperimentEvidence, evaluateStoredExperiment, getExperiment } from './experiments.js';

const METRICS = [
  'test_pass_rate',
  'test_failure_count',
  'lint_error_count',
  'task_success_score'
] as const;

export type RepositoryMetric = typeof METRICS[number];

export const repositoryMetricInputSchema = z.object({
  experimentId: z.string().min(1),
  metric: z.enum(METRICS),
  repositoryTask: z.object({
    taskId: z.string().min(1)
  }).strict()
}).strict();

type RepositoryMetricInput = z.infer<typeof repositoryMetricInputSchema>;

type ParsedMetric = {
  observed: number;
  derivation: string;
  passed?: number;
  failed?: number;
};

function parseVitest(output: string): ParsedMetric {
  const passedMatch = output.match(/Tests\s+(?:(\d+) failed[^\n]*\|\s*)?(\d+) passed/i);
  const failedOnly = output.match(/Tests\s+(\d+) failed/i);
  const passed = passedMatch ? Number(passedMatch[2]) : 0;
  const failed = passedMatch?.[1] ? Number(passedMatch[1]) : failedOnly ? Number(failedOnly[1]) : 0;
  const total = passed + failed;
  if (total === 0) throw new Error('Could not derive a Vitest test count from bounded task output.');
  return {
    observed: passed / total,
    derivation: `Parsed Vitest summary: ${passed} passed, ${failed} failed.`,
    passed,
    failed
  };
}

function parseVitestFailures(output: string): ParsedMetric {
  const rate = parseVitest(output);
  return {
    ...rate,
    observed: rate.failed || 0,
    derivation: `Parsed Vitest failure count: ${rate.failed || 0}.`
  };
}

function parseEslintErrors(output: string, exitCode: number | null): ParsedMetric {
  const summary = output.match(/(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/i);
  if (summary) {
    return {
      observed: Number(summary[2]),
      derivation: `Parsed ESLint summary: ${summary[2]} errors, ${summary[3]} warnings.`
    };
  }
  if (exitCode === 0) {
    return { observed: 0, derivation: 'ESLint exited successfully with no reported error summary.' };
  }
  throw new Error('Could not derive ESLint error count from failed bounded task output.');
}

export function deriveRepositoryMetric(input: {
  metric: RepositoryMetric;
  taskType: 'test' | 'lint' | 'typecheck' | 'debug' | 'audit';
  taskStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}): ParsedMetric {
  const output = `${input.stdout}\n${input.stderr}`;

  if (input.metric === 'task_success_score') {
    const success = input.taskStatus === 'completed' && input.exitCode === 0 && !input.timedOut;
    return {
      observed: success ? 1 : 0,
      derivation: `Derived from task status '${input.taskStatus}', exitCode ${input.exitCode}, timedOut ${input.timedOut}.`
    };
  }
  if (input.metric === 'test_pass_rate') {
    if (input.taskType !== 'test') throw new Error('test_pass_rate requires a bounded test task.');
    return parseVitest(output);
  }
  if (input.metric === 'test_failure_count') {
    if (input.taskType !== 'test') throw new Error('test_failure_count requires a bounded test task.');
    return parseVitestFailures(output);
  }
  if (input.taskType !== 'lint') throw new Error('lint_error_count requires a bounded lint task.');
  return parseEslintErrors(output, input.exitCode);
}

function digestEvidence(value: object) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function evaluateExperimentFromRepositoryTask(input: RepositoryMetricInput) {
  const experiment = getExperiment(input.experimentId);
  if (experiment.metric !== input.metric) {
    throw new Error(`Repository metric '${input.metric}' does not match experiment metric '${experiment.metric}'.`);
  }

  const status = getTaskStatus(input.repositoryTask.taskId);
  const task = getTaskResult(input.repositoryTask.taskId);
  const result = task.result;
  if (!result) throw new Error(`Task '${task.id}' has no bounded result.`);

  const parsed = deriveRepositoryMetric({
    metric: input.metric,
    taskType: status.taskType,
    taskStatus: task.status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr
  });

  const evidenceBase = {
    kind: 'repository-metric' as const,
    taskId: task.id,
    taskType: status.taskType,
    repo: status.repo,
    action: result.action,
    metric: input.metric,
    observed: parsed.observed,
    derivation: parsed.derivation,
    exitCode: result.exitCode,
    timedOut: result.timedOut
  };
  const evidence = {
    ...evidenceBase,
    evidenceDigest: digestEvidence(evidenceBase)
  };

  attachExperimentEvidence(input.experimentId, evidence);
  const evaluated = evaluateStoredExperiment({
    experimentId: input.experimentId,
    status: 'completed',
    observed: parsed.observed
  });

  return { ...evaluated, evidence };
}

export function repositoryMetricLimits() {
  return {
    supportedMetrics: [...METRICS],
    source: 'bounded-agent-task',
    execution: 'existing-allowlisted-task-only',
    writes: false,
    unsupportedUntilAllowlisted: ['typecheck_error_count']
  };
}
