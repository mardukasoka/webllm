import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import {
  appendExperimentRecord,
  createExperimentPlan,
  evaluateExperiment
} from '../../lib/experiment-ledger.js';
import type {
  EvaluatedExperiment,
  ExperimentPlan
} from '../../lib/experiment-ledger.js';

const experimentRecords: EvaluatedExperiment[] = [];

type CouncilComparisonEvidence = Readonly<{
  kind: 'council-comparison';
  reviewId: string;
  evidenceDigest: string;
  metric: string;
  observed: number;
  derivation: string;
  participantCount: number;
}>;

type WolframVerificationEvidence = Readonly<{
  kind: 'wolfram-verification';
  mode: 'wolfram' | 'wolfram-alpha' | 'wolfram-language';
  operation: 'equation' | 'numeric' | 'units' | 'constant' | 'statistics' | 'astronomy' | 'physics';
  metric: string;
  observed: number;
  verified: boolean;
  query: string;
  computation: string;
  result: string;
  evidenceDigest: string;
}>;

type RepositoryMetricEvidence = Readonly<{
  kind: 'repository-metric';
  taskId: string;
  taskType: 'test' | 'lint' | 'typecheck' | 'debug' | 'audit';
  repo: string;
  action: string;
  metric: 'test_pass_rate' | 'test_failure_count' | 'lint_error_count' | 'typecheck_error_count' | 'task_success_score';
  observed: number;
  derivation: string;
  exitCode: number | null;
  timedOut: boolean;
  evidenceDigest: string;
}>;

type ExperimentEvidence = CouncilComparisonEvidence | WolframVerificationEvidence | RepositoryMetricEvidence;

const experimentEvidence = new Map<string, ExperimentEvidence>();

export const experimentPlanInputSchema = z.object({
  experimentId: z.string().min(1).optional(),
  goal: z.string().min(1),
  hypothesis: z.string().min(1),
  metric: z.string().min(1),
  direction: z.enum(['maximize', 'minimize']),
  baseline: z.number().finite(),
  minimumDelta: z.number().finite().min(0).optional(),
  sourceCommit: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).optional()
}).strict();

export const experimentEvaluateInputSchema = z.object({
  experimentId: z.string().min(1),
  status: z.string().min(1),
  observed: z.number().finite().optional(),
  reason: z.string().min(1).optional()
}).strict();

type ExperimentPlanInput = z.infer<typeof experimentPlanInputSchema>;
type ExperimentEvaluateInput = z.infer<typeof experimentEvaluateInputSchema>;

type PlannedExperiment = ExperimentPlan;

const plans = new Map<string, PlannedExperiment>();

export function createExperiment(input: ExperimentPlanInput) {
  const experimentId = input.experimentId?.trim() || randomUUID();
  if (plans.has(experimentId)) {
    throw new Error(`Experiment '${experimentId}' already exists.`);
  }

  const plan = createExperimentPlan({
    ...input,
    experimentId,
    minimumDelta: input.minimumDelta ?? 0,
    parameters: input.parameters ?? {}
  });

  plans.set(experimentId, plan);
  return {
    status: 'planned',
    ...plan,
    execution: 'external',
    writes: false
  };
}

export function evaluateStoredExperiment(input: ExperimentEvaluateInput) {
  const plan = plans.get(input.experimentId);
  if (!plan) throw new Error(`Unknown experiment id '${input.experimentId}'.`);
  if (experimentRecords.some((entry) => entry.experimentId === input.experimentId)) {
    throw new Error(`Experiment '${input.experimentId}' has already been evaluated.`);
  }

  const evaluated = evaluateExperiment(plan, {
    status: input.status,
    observed: input.observed,
    reason: input.reason
  });

  const next = appendExperimentRecord(experimentRecords, evaluated);
  experimentRecords.splice(0, experimentRecords.length, ...next);
  return evaluated;
}

export function attachExperimentEvidence(experimentId: string, evidence: ExperimentEvidence) {
  if (!plans.has(experimentId)) {
    throw new Error(`Unknown experiment id '${experimentId}'.`);
  }
  if (experimentEvidence.has(experimentId)) {
    throw new Error(`Experiment '${experimentId}' already has attached evidence.`);
  }
  experimentEvidence.set(experimentId, Object.freeze({ ...evidence }) as ExperimentEvidence);
  return experimentEvidence.get(experimentId)!;
}

function withEvidence<T extends object>(experimentId: string, value: T) {
  const evidence = experimentEvidence.get(experimentId);
  return evidence ? { ...value, evidence } : value;
}

export function getExperiment(experimentId: string) {
  const record = experimentRecords.find((entry) => entry.experimentId === experimentId);
  if (record) return withEvidence(experimentId, record);
  const plan = plans.get(experimentId);
  if (!plan) throw new Error(`Unknown experiment id '${experimentId}'.`);
  return withEvidence(experimentId, { status: 'planned', ...plan, execution: 'external', writes: false });
}

export function listExperiments() {
  return [...plans.values()].map((plan) => {
    const record = experimentRecords.find((entry) => entry.experimentId === plan.experimentId);
    const value = record || { status: 'planned', ...plan, execution: 'external', writes: false };
    return withEvidence(plan.experimentId, value);
  });
}

export function experimentStatus() {
  const evidenceCounts = [...experimentEvidence.values()].reduce(
    (counts, evidence) => ({
      ...counts,
      [evidence.kind]: (counts[evidence.kind] || 0) + 1
    }),
    {} as Record<ExperimentEvidence['kind'], number>
  );

  return {
    supported: true,
    persistence: 'in-memory',
    execution: 'external',
    writes: false,
    planned: plans.size,
    evaluated: experimentRecords.length,
    evidenceAttached: experimentEvidence.size,
    evidenceCounts,
    dispositions: ['keep', 'reject', 'inconclusive']
  };
}
