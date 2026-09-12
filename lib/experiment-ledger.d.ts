export type ExperimentDirection = 'maximize' | 'minimize';
export type ExperimentDisposition = 'keep' | 'reject' | 'inconclusive';

export interface ExperimentPlan {
  experimentId: string;
  goal: string;
  hypothesis: string;
  metric: string;
  direction: ExperimentDirection;
  baseline: number;
  minimumDelta: number;
  sourceCommit: string;
  parameters: Record<string, unknown>;
}

export interface ExperimentPlanInput extends Omit<ExperimentPlan, 'minimumDelta'> {
  minimumDelta?: number;
}

export interface ExperimentResult {
  status: string;
  observed?: number;
  reason?: string;
}

export interface EvaluatedExperiment extends ExperimentPlan {
  status: string;
  observed: number | null;
  delta: number | null;
  disposition: ExperimentDisposition;
  reason: string;
}

export function createExperimentPlan(input: ExperimentPlanInput): Readonly<ExperimentPlan>;
export function evaluateExperiment(
  plan: ExperimentPlan,
  result: ExperimentResult
): Readonly<EvaluatedExperiment>;
export function appendExperimentRecord(
  ledger: readonly EvaluatedExperiment[],
  evaluated: EvaluatedExperiment
): readonly Readonly<EvaluatedExperiment>[];
