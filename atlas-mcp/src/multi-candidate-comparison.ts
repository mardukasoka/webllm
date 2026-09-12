import * as z from 'zod/v4';
import { getMultiExperiment } from './multi-experiments.js';

export const multiCandidateComparisonInputSchema = z.object({
  experimentIds: z.array(z.string().min(1)).min(2).max(6)
}).strict();

type Input = z.infer<typeof multiCandidateComparisonInputSchema>;

function metricSignature(experiment: ReturnType<typeof getMultiExperiment>) {
  return JSON.stringify(experiment.metrics.map((entry) => ({
    metric: entry.metric,
    direction: entry.direction,
    baseline: entry.baseline,
    minimumDelta: entry.minimumDelta,
    required: entry.required
  })));
}

export function compareMultiExperimentCandidates(input: Input) {
  const parsed = multiCandidateComparisonInputSchema.parse(input);
  if (new Set(parsed.experimentIds).size !== parsed.experimentIds.length) {
    throw new Error('Candidate experiment ids must be unique.');
  }

  const experiments = parsed.experimentIds.map(getMultiExperiment);
  const signature = metricSignature(experiments[0]);
  if (experiments.some((experiment) => metricSignature(experiment) !== signature)) {
    throw new Error('Candidate experiments must declare identical metric definitions in identical order.');
  }

  const metrics = experiments[0].metrics.map((definition) => ({
    ...definition,
    candidates: experiments.map((experiment) => {
      const observation = experiment.observations.find((entry) => entry.metric === definition.metric);
      return {
        experimentId: experiment.experimentId,
        observed: observation?.observed ?? null,
        delta: observation?.delta ?? null,
        disposition: observation?.disposition ?? 'unobserved',
        evidenceKind: observation?.evidence.kind ?? null,
        evidenceDigest: observation?.evidence.evidenceDigest ?? null
      };
    })
  }));

  return {
    status: 'compared',
    candidateCount: experiments.length,
    candidates: experiments.map((experiment) => ({
      experimentId: experiment.experimentId,
      sourceCommit: experiment.sourceCommit,
      overallDisposition: experiment.overallDisposition,
      observedMetricCount: experiment.observedMetricCount
    })),
    metrics,
    limitations: [
      'No candidate is ranked, selected, merged, or declared the winner.',
      'Per-metric observations remain separate and are not averaged into an aggregate score.',
      'Missing observations remain explicit rather than being imputed.'
    ]
  };
}
