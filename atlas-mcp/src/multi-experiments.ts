import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';

const metricDefinitionSchema = z.object({
  metric: z.string().min(1),
  direction: z.enum(['maximize', 'minimize']),
  baseline: z.number().finite(),
  minimumDelta: z.number().finite().min(0).default(0),
  required: z.boolean().default(true)
}).strict();

export const multiExperimentCreateInputSchema = z.object({
  experimentId: z.string().min(1).optional(),
  goal: z.string().min(1),
  hypothesis: z.string().min(1),
  sourceCommit: z.string().min(1),
  metrics: z.array(metricDefinitionSchema).min(1).max(12),
  parameters: z.record(z.string(), z.unknown()).optional()
}).strict();

export const multiExperimentObserveInputSchema = z.object({
  experimentId: z.string().min(1),
  metric: z.string().min(1),
  observed: z.number().finite(),
  evidence: z.object({
    kind: z.enum(['repository-metric', 'wolfram-verification', 'council-comparison', 'external']),
    evidenceDigest: z.string().min(1),
    sourceId: z.string().min(1).optional()
  }).strict()
}).strict();

type MetricDefinition = z.infer<typeof metricDefinitionSchema>;
type MultiExperimentCreateInput = z.infer<typeof multiExperimentCreateInputSchema>;
type MultiExperimentObserveInput = z.infer<typeof multiExperimentObserveInputSchema>;

type MetricDisposition = 'keep' | 'reject' | 'inconclusive';
type OverallDisposition = MetricDisposition;

type MetricObservation = Readonly<{
  metric: string;
  observed: number;
  delta: number;
  disposition: MetricDisposition;
  reason: string;
  evidence: {
    kind: 'repository-metric' | 'wolfram-verification' | 'council-comparison' | 'external';
    evidenceDigest: string;
    sourceId?: string;
  };
}>;

type MultiExperiment = {
  experimentId: string;
  goal: string;
  hypothesis: string;
  sourceCommit: string;
  metrics: ReadonlyArray<MetricDefinition>;
  parameters: Readonly<Record<string, unknown>>;
  observations: Map<string, MetricObservation>;
  createdAt: string;
};

const experiments = new Map<string, MultiExperiment>();

function evaluateMetric(definition: MetricDefinition, observed: number): MetricObservation {
  const delta = definition.direction === 'maximize'
    ? observed - definition.baseline
    : definition.baseline - observed;

  let disposition: MetricDisposition;
  let reason: string;
  if (delta >= definition.minimumDelta) {
    disposition = 'keep';
    reason = `Metric improved by ${delta}, meeting the required delta ${definition.minimumDelta}.`;
  } else if (delta < 0) {
    disposition = 'reject';
    reason = `Metric regressed by ${Math.abs(delta)}.`;
  } else {
    disposition = 'inconclusive';
    reason = `Metric improved by ${delta}, below the required delta ${definition.minimumDelta}.`;
  }

  return {
    metric: definition.metric,
    observed,
    delta,
    disposition,
    reason,
    evidence: { kind: 'external', evidenceDigest: '' }
  };
}

function overallDisposition(experiment: MultiExperiment): OverallDisposition {
  const required = experiment.metrics.filter((metric) => metric.required);
  if (required.length === 0) return 'inconclusive';

  for (const definition of required) {
    const observation = experiment.observations.get(definition.metric);
    if (observation?.disposition === 'reject') return 'reject';
  }

  const allRequiredObserved = required.every((definition) => experiment.observations.has(definition.metric));
  if (!allRequiredObserved) return 'inconclusive';

  const allRequiredKeep = required.every(
    (definition) => experiment.observations.get(definition.metric)?.disposition === 'keep'
  );
  return allRequiredKeep ? 'keep' : 'inconclusive';
}

function serialize(experiment: MultiExperiment) {
  const observations = experiment.metrics
    .map((definition) => experiment.observations.get(definition.metric))
    .filter((value): value is MetricObservation => Boolean(value));

  return {
    experimentId: experiment.experimentId,
    goal: experiment.goal,
    hypothesis: experiment.hypothesis,
    sourceCommit: experiment.sourceCommit,
    metrics: experiment.metrics,
    parameters: experiment.parameters,
    observations,
    createdAt: experiment.createdAt,
    overallDisposition: overallDisposition(experiment),
    observedMetricCount: observations.length,
    requiredMetricCount: experiment.metrics.filter((metric) => metric.required).length,
    writes: false,
    execution: 'external'
  };
}

export function createMultiExperiment(input: MultiExperimentCreateInput) {
  const parsed = multiExperimentCreateInputSchema.parse(input);
  const experimentId = parsed.experimentId?.trim() || randomUUID();
  if (experiments.has(experimentId)) throw new Error(`Multi-metric experiment '${experimentId}' already exists.`);

  const metricNames = parsed.metrics.map((metric) => metric.metric);
  if (new Set(metricNames).size !== metricNames.length) {
    throw new Error('Multi-metric experiment metrics must have unique names.');
  }

  const experiment: MultiExperiment = {
    experimentId,
    goal: parsed.goal,
    hypothesis: parsed.hypothesis,
    sourceCommit: parsed.sourceCommit,
    metrics: Object.freeze(parsed.metrics.map((metric) => Object.freeze({ ...metric }))),
    parameters: Object.freeze({ ...(parsed.parameters ?? {}) }),
    observations: new Map(),
    createdAt: new Date().toISOString()
  };
  experiments.set(experimentId, experiment);
  return serialize(experiment);
}

export function observeMultiExperiment(input: MultiExperimentObserveInput) {
  const parsed = multiExperimentObserveInputSchema.parse(input);
  const experiment = experiments.get(parsed.experimentId);
  if (!experiment) throw new Error(`Unknown multi-metric experiment '${parsed.experimentId}'.`);
  if (experiment.observations.has(parsed.metric)) {
    throw new Error(`Metric '${parsed.metric}' has already been observed for experiment '${parsed.experimentId}'.`);
  }

  const definition = experiment.metrics.find((metric) => metric.metric === parsed.metric);
  if (!definition) throw new Error(`Metric '${parsed.metric}' is not declared by experiment '${parsed.experimentId}'.`);

  const evaluated = evaluateMetric(definition, parsed.observed);
  const observation: MetricObservation = Object.freeze({
    ...evaluated,
    evidence: Object.freeze({ ...parsed.evidence })
  });
  experiment.observations.set(parsed.metric, observation);
  return serialize(experiment);
}

export function getMultiExperiment(experimentId: string) {
  const experiment = experiments.get(experimentId);
  if (!experiment) throw new Error(`Unknown multi-metric experiment '${experimentId}'.`);
  return serialize(experiment);
}

export function listMultiExperiments() {
  return [...experiments.values()].map(serialize);
}

export function multiExperimentStatus() {
  return {
    supported: true,
    persistence: 'in-memory',
    execution: 'external',
    writes: false,
    experiments: experiments.size,
    maxMetricsPerExperiment: 12,
    overallRule: 'required reject => reject; all required observed and keep => keep; otherwise inconclusive'
  };
}
