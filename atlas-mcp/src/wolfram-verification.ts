import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import {
  attachExperimentEvidence,
  evaluateStoredExperiment,
  getExperiment
} from './experiments.js';

const MAX_QUERY_CHARS = 4_000;
const MAX_TRACE_CHARS = 8_000;

const wolframModeSchema = z.enum(['wolfram', 'wolfram-alpha', 'wolfram-language']);
const wolframOperationSchema = z.enum([
  'equation',
  'numeric',
  'units',
  'constant',
  'statistics',
  'astronomy',
  'physics'
]);

export const wolframExperimentInputSchema = z.object({
  experimentId: z.string().min(1),
  metric: z.string().min(1),
  wolfram: z.object({
    mode: wolframModeSchema,
    operation: wolframOperationSchema,
    query: z.string().min(1).max(MAX_QUERY_CHARS),
    computation: z.string().min(1).max(MAX_TRACE_CHARS),
    result: z.string().min(1).max(MAX_TRACE_CHARS),
    verified: z.boolean()
  }).strict()
}).strict();

type WolframExperimentInput = z.infer<typeof wolframExperimentInputSchema>;

function digestEvidence(input: WolframExperimentInput['wolfram']) {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
}

export function evaluateExperimentFromWolfram(input: WolframExperimentInput) {
  const experiment = getExperiment(input.experimentId);
  if (experiment.status !== 'planned') {
    throw new Error(`Experiment '${input.experimentId}' has already been evaluated.`);
  }
  if (experiment.metric !== input.metric) {
    throw new Error(
      `Wolfram metric '${input.metric}' does not match experiment metric '${experiment.metric}'.`
    );
  }

  const observed = input.wolfram.verified ? 1 : 0;
  const evidence = Object.freeze({
    kind: 'wolfram-verification' as const,
    mode: input.wolfram.mode,
    operation: input.wolfram.operation,
    metric: input.metric,
    observed,
    verified: input.wolfram.verified,
    query: input.wolfram.query,
    computation: input.wolfram.computation,
    result: input.wolfram.result,
    evidenceDigest: digestEvidence(input.wolfram)
  });

  attachExperimentEvidence(input.experimentId, evidence);
  const evaluated = evaluateStoredExperiment({
    experimentId: input.experimentId,
    status: 'completed',
    observed,
    reason: input.wolfram.verified
      ? 'Wolfram verification succeeded.'
      : 'Wolfram verification contradicted the tested claim.'
  });

  return {
    ...evaluated,
    evidence
  };
}

export function wolframVerificationLimits() {
  return {
    modes: ['wolfram', 'wolfram-alpha', 'wolfram-language'],
    operations: ['equation', 'numeric', 'units', 'constant', 'statistics', 'astronomy', 'physics'],
    metricRange: [0, 1],
    derivation: 'verified => 1; contradicted => 0',
    maxQueryChars: MAX_QUERY_CHARS,
    maxTraceChars: MAX_TRACE_CHARS,
    execution: 'external-wolfram-mcp',
    writes: false
  };
}
