import { createHash } from 'node:crypto';
import * as z from 'zod/v4';
import { getMultiExperiment, observeMultiExperiment } from './multi-experiments.js';

const MAX_QUERY_CHARS = 4_000;
const MAX_TRACE_CHARS = 8_000;

export const multiWolframInputSchema = z.object({
  experimentId: z.string().min(1),
  metric: z.string().min(1),
  wolfram: z.object({
    mode: z.enum(['wolfram', 'wolfram-alpha', 'wolfram-language']),
    operation: z.enum(['equation', 'numeric', 'units', 'constant', 'statistics', 'astronomy', 'physics']),
    query: z.string().min(1).max(MAX_QUERY_CHARS),
    computation: z.string().min(1).max(MAX_TRACE_CHARS),
    result: z.string().min(1).max(MAX_TRACE_CHARS),
    verified: z.boolean()
  }).strict()
}).strict();

type MultiWolframInput = z.infer<typeof multiWolframInputSchema>;

function digestEvidence(value: object) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function observeMultiExperimentFromWolfram(input: MultiWolframInput) {
  const parsed = multiWolframInputSchema.parse(input);
  const experiment = getMultiExperiment(parsed.experimentId);
  if (!experiment.metrics.some((entry) => entry.metric === parsed.metric)) {
    throw new Error(`Metric '${parsed.metric}' is not declared by experiment '${parsed.experimentId}'.`);
  }
  if (experiment.observations.some((entry) => entry.metric === parsed.metric)) {
    throw new Error(`Metric '${parsed.metric}' has already been observed for experiment '${parsed.experimentId}'.`);
  }

  const observed = parsed.wolfram.verified ? 1 : 0;
  const evidenceBase = {
    mode: parsed.wolfram.mode,
    operation: parsed.wolfram.operation,
    metric: parsed.metric,
    observed,
    verified: parsed.wolfram.verified,
    query: parsed.wolfram.query,
    computation: parsed.wolfram.computation,
    result: parsed.wolfram.result
  };
  const evidenceDigest = digestEvidence(evidenceBase);

  const updated = observeMultiExperiment({
    experimentId: parsed.experimentId,
    metric: parsed.metric,
    observed,
    evidence: {
      kind: 'wolfram-verification',
      evidenceDigest,
      sourceId: `${parsed.wolfram.mode}:${parsed.wolfram.operation}`
    }
  });

  return {
    ...updated,
    evidence: {
      kind: 'wolfram-verification' as const,
      ...evidenceBase,
      evidenceDigest
    },
    limitations: [
      'Wolfram execution is external to Atlas MCP.',
      'The bridge records verified as 1 and contradicted as 0; conditional symbolic results must be classified explicitly by the caller.',
      'No repository write or automatic keep/revert action is performed.'
    ]
  };
}
