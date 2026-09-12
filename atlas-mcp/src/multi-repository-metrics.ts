import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { getTaskResult, getTaskStatus } from './agents.js';
import { getMultiExperiment, observeMultiExperiment } from './multi-experiments.js';
import { deriveRepositoryMetric, type RepositoryMetric } from './repository-metrics.js';

const REPOSITORY_METRICS = [
  'test_pass_rate',
  'test_failure_count',
  'lint_error_count',
  'typecheck_error_count',
  'task_success_score'
] as const;

export const multiRepositoryMetricInputSchema = z.object({
  experimentId: z.string().min(1),
  metric: z.enum(REPOSITORY_METRICS),
  repositoryTask: z.object({ taskId: z.string().min(1) }).strict()
}).strict();

type MultiRepositoryMetricInput = z.infer<typeof multiRepositoryMetricInputSchema>;

function digestEvidence(value: object) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function deriveMultiRepositoryObservation(input: {
  metric: RepositoryMetric;
  taskId: string;
  taskType: 'test' | 'lint' | 'typecheck' | 'debug' | 'audit';
  taskStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  repo: string;
  action: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}) {
  const parsed = deriveRepositoryMetric({
    metric: input.metric,
    taskType: input.taskType,
    taskStatus: input.taskStatus,
    exitCode: input.exitCode,
    timedOut: input.timedOut,
    stdout: input.stdout,
    stderr: input.stderr
  });

  const evidenceBase = {
    kind: 'repository-metric' as const,
    taskId: input.taskId,
    taskType: input.taskType,
    repo: input.repo,
    action: input.action,
    metric: input.metric,
    observed: parsed.observed,
    derivation: parsed.derivation,
    exitCode: input.exitCode,
    timedOut: input.timedOut
  };

  return {
    observed: parsed.observed,
    evidence: {
      ...evidenceBase,
      evidenceDigest: digestEvidence(evidenceBase)
    }
  };
}

export function observeMultiExperimentFromRepositoryTask(input: MultiRepositoryMetricInput) {
  const parsed = multiRepositoryMetricInputSchema.parse(input);
  const experiment = getMultiExperiment(parsed.experimentId);
  if (!experiment.metrics.some((definition) => definition.metric === parsed.metric)) {
    throw new Error(`Metric '${parsed.metric}' is not declared by multi-metric experiment '${parsed.experimentId}'.`);
  }

  const status = getTaskStatus(parsed.repositoryTask.taskId);
  const task = getTaskResult(parsed.repositoryTask.taskId);
  const result = task.result;
  if (!result) throw new Error(`Task '${task.id}' has no bounded result.`);

  const derived = deriveMultiRepositoryObservation({
    metric: parsed.metric,
    taskId: task.id,
    taskType: status.taskType,
    taskStatus: task.status,
    repo: status.repo,
    action: result.action,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr
  });

  const updated = observeMultiExperiment({
    experimentId: parsed.experimentId,
    metric: parsed.metric,
    observed: derived.observed,
    evidence: {
      kind: 'repository-metric',
      evidenceDigest: derived.evidence.evidenceDigest,
      sourceId: task.id
    }
  });

  return { ...updated, derivedEvidence: derived.evidence };
}

export function multiRepositoryMetricLimits() {
  return {
    supportedMetrics: [...REPOSITORY_METRICS],
    source: 'bounded-agent-task',
    execution: 'existing-allowlisted-task-only',
    writes: false
  };
}
