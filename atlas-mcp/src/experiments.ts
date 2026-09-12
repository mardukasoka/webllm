import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
// The root helper is plain JavaScript and is covered by the repository Vitest suite.
// @ts-ignore -- no declaration file is emitted for this browser/shared helper.
import {
  appendExperimentRecord,
  createExperimentPlan,
  evaluateExperiment
} from '../../lib/experiment-ledger.js';

const experimentRecords: unknown[] = [];

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

type PlannedExperiment = {
  experimentId: string;
  goal: string;
  hypothesis: string;
  metric: string;
  direction: 'maximize' | 'minimize';
  baseline: number;
  minimumDelta: number;
  sourceCommit: string;
  parameters: Record<string, unknown>;
};

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
  }) as PlannedExperiment;

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
  if (experimentRecords.some((entry: any) => entry.experimentId === input.experimentId)) {
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

export function getExperiment(experimentId: string) {
  const record = experimentRecords.find((entry: any) => entry.experimentId === experimentId);
  if (record) return record;
  const plan = plans.get(experimentId);
  if (!plan) throw new Error(`Unknown experiment id '${experimentId}'.`);
  return { status: 'planned', ...plan, execution: 'external', writes: false };
}

export function listExperiments() {
  return [...plans.values()].map((plan) => {
    const record = experimentRecords.find((entry: any) => entry.experimentId === plan.experimentId);
    return record || { status: 'planned', ...plan, execution: 'external', writes: false };
  });
}

export function experimentStatus() {
  return {
    supported: true,
    persistence: 'in-memory',
    execution: 'external',
    writes: false,
    planned: plans.size,
    evaluated: experimentRecords.length,
    dispositions: ['keep', 'reject', 'inconclusive']
  };
}
