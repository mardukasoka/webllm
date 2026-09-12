import * as z from 'zod/v4';
import {
  attachExperimentEvidence,
  evaluateStoredExperiment,
  getExperiment
} from './experiments.js';

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

export const comparisonExperimentInputSchema = z.object({
  experimentId: z.string().min(1),
  metric: z.string().min(1),
  observed: z.number().finite(),
  derivation: z.string().min(1).max(2000),
  comparison: comparisonSchema
}).strict();

type ComparisonExperimentInput = z.infer<typeof comparisonExperimentInputSchema>;

export function evaluateExperimentFromComparison(input: ComparisonExperimentInput) {
  const experiment = getExperiment(input.experimentId);

  if ('disposition' in experiment) {
    throw new Error(`Experiment '${input.experimentId}' has already been evaluated.`);
  }
  if (experiment.metric !== input.metric) {
    throw new Error(
      `Comparison metric '${input.metric}' does not match experiment metric '${experiment.metric}'.`
    );
  }

  const comparison = comparisonSchema.parse(input.comparison);
  const evaluated = evaluateStoredExperiment({
    experimentId: input.experimentId,
    status: 'completed',
    observed: input.observed,
    reason: `Council comparison metric derived explicitly: ${input.derivation}`
  });

  const evidence = attachExperimentEvidence(input.experimentId, {
    kind: 'council-comparison',
    reviewId: comparison.reviewId,
    evidenceDigest: comparison.evidenceDigest,
    metric: input.metric,
    observed: input.observed,
    derivation: input.derivation,
    participantCount: comparison.participantCount
  });

  return {
    ...evaluated,
    evidence,
    limitations: [
      'The Council comparison does not rank, vote, or select a winning proposal.',
      'The numeric observed value and its derivation are supplied explicitly by the caller.',
      'No repository write, model training, or automatic keep/revert action is performed.'
    ]
  };
}
