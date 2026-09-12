import * as z from 'zod/v4';
import { getMultiExperiment, observeMultiExperiment } from './multi-experiments.js';

const comparisonSchema = z.object({
  ok: z.literal(true),
  status: z.literal('compared'),
  reviewId: z.string().min(1),
  evidenceDigest: z.string().min(1),
  participantCount: z.number().int().min(2).max(8),
  agreements: z.object({
    sharedPaths: z.array(z.string()),
    sharedTests: z.array(z.string()),
    allApplyRequestedFalse: z.literal(true)
  }).strict(),
  disagreements: z.object({
    paths: z.array(z.string()),
    tests: z.array(z.string()),
    confidence: z.array(z.string())
  }).strict()
}).passthrough();

export const multiComparisonInputSchema = z.object({
  experimentId: z.string().min(1),
  metric: z.string().min(1),
  observed: z.number().finite(),
  derivation: z.string().min(1).max(2000),
  comparison: comparisonSchema
}).strict();

type MultiComparisonInput = z.infer<typeof multiComparisonInputSchema>;

export function observeMultiExperimentFromComparison(input: MultiComparisonInput) {
  const parsed = multiComparisonInputSchema.parse(input);
  const experiment = getMultiExperiment(parsed.experimentId);
  if (!experiment.metrics.some((entry) => entry.metric === parsed.metric)) {
    throw new Error(`Metric '${parsed.metric}' is not declared by experiment '${parsed.experimentId}'.`);
  }
  if (experiment.observations.some((entry) => entry.metric === parsed.metric)) {
    throw new Error(`Metric '${parsed.metric}' has already been observed for experiment '${parsed.experimentId}'.`);
  }

  const comparison = comparisonSchema.parse(parsed.comparison);
  const updated = observeMultiExperiment({
    experimentId: parsed.experimentId,
    metric: parsed.metric,
    observed: parsed.observed,
    evidence: {
      kind: 'council-comparison',
      evidenceDigest: comparison.evidenceDigest,
      sourceId: comparison.reviewId
    }
  });

  return {
    ...updated,
    evidence: {
      kind: 'council-comparison' as const,
      reviewId: comparison.reviewId,
      evidenceDigest: comparison.evidenceDigest,
      participantCount: comparison.participantCount,
      metric: parsed.metric,
      observed: parsed.observed,
      derivation: parsed.derivation
    },
    limitations: [
      'The Council comparison does not rank, vote, or select a winning proposal.',
      'The numeric observed value and derivation remain explicit caller-supplied inputs.',
      'No repository write, model training, or automatic keep/revert action is performed.'
    ]
  };
}
