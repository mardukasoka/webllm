import * as z from 'zod/v4';
import { getTaskStatus, submitTask, watchTask, type TaskType } from './agents.js';
import { getMultiExperiment } from './multi-experiments.js';
import { observeMultiExperimentFromRepositoryTask } from './multi-repository-metrics.js';
import type { RepositoryMetric } from './repository-metrics.js';

const AUTOMATED_METRICS = [
  'test_pass_rate',
  'test_failure_count',
  'lint_error_count',
  'typecheck_error_count'
] as const;

type AutomatedMetric = typeof AUTOMATED_METRICS[number];

const metricTaskType: Record<AutomatedMetric, TaskType> = {
  test_pass_rate: 'test',
  test_failure_count: 'test',
  lint_error_count: 'lint',
  typecheck_error_count: 'typecheck'
};

export const orchestrateExperimentInputSchema = z.object({
  experimentId: z.string().min(1),
  metrics: z.array(z.enum(AUTOMATED_METRICS)).min(1).max(4),
  timeoutMinutes: z.number().int().min(1).max(60).default(10)
}).strict();

type OrchestrateExperimentInput = z.infer<typeof orchestrateExperimentInputSchema>;

function waitForTask(taskId: string): Promise<void> {
  const status = getTaskStatus(taskId);
  if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    watchTask(taskId, resolve);
  });
}

export async function orchestrateMultiExperiment(input: OrchestrateExperimentInput) {
  const parsed = orchestrateExperimentInputSchema.parse(input);
  const experiment = getMultiExperiment(parsed.experimentId);
  const declared = new Set(experiment.metrics.map((entry) => entry.metric));
  const observed = new Set(experiment.observations.map((entry) => entry.metric));

  for (const metric of parsed.metrics) {
    if (!declared.has(metric)) {
      throw new Error(`Metric '${metric}' is not declared by experiment '${parsed.experimentId}'.`);
    }
    if (observed.has(metric)) {
      throw new Error(`Metric '${metric}' has already been observed for experiment '${parsed.experimentId}'.`);
    }
  }

  const taskTypes = [...new Set(parsed.metrics.map((metric) => metricTaskType[metric]))];
  const tasks = new Map<TaskType, string>();

  for (const taskType of taskTypes) {
    const submitted = submitTask({
      taskType,
      repo: 'webllm',
      writeMode: 'read-only',
      maxAgents: 1,
      timeoutMinutes: parsed.timeoutMinutes
    });
    tasks.set(taskType, submitted.id);
  }

  await Promise.all([...tasks.values()].map(waitForTask));

  const observations = [];
  for (const metric of parsed.metrics) {
    const taskType = metricTaskType[metric];
    const taskId = tasks.get(taskType)!;
    const result = observeMultiExperimentFromRepositoryTask({
      experimentId: parsed.experimentId,
      metric: metric as RepositoryMetric,
      repositoryTask: { taskId }
    });
    observations.push({ metric, taskId, overallDisposition: result.overallDisposition });
  }

  return {
    experiment: getMultiExperiment(parsed.experimentId),
    tasks: [...tasks.entries()].map(([taskType, taskId]) => ({
      taskType,
      taskId,
      status: getTaskStatus(taskId).status
    })),
    observations,
    execution: 'existing-allowlisted-task-only',
    writes: false,
    limitations: [
      'Only WebLLM test, lint, and Atlas MCP typecheck tasks are orchestrated.',
      'The orchestrator does not modify files, create branches, apply proposals, or merge code.',
      'Wolfram and Council evidence remain separately attached through their bounded bridges.'
    ]
  };
}

export function experimentOrchestratorLimits() {
  return {
    supportedMetrics: [...AUTOMATED_METRICS],
    repository: 'webllm',
    writeMode: 'read-only',
    maxAgentsPerTask: 1,
    execution: 'existing-allowlisted-task-only',
    writes: false
  };
}
