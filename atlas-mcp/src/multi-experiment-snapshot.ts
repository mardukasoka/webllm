import * as z from 'zod/v4';
import {
  createMultiExperiment,
  getMultiExperiment,
  listMultiExperiments,
  observeMultiExperiment
} from './multi-experiments.js';

const metricSchema = z.object({
  metric: z.string().min(1),
  direction: z.enum(['maximize', 'minimize']),
  baseline: z.number().finite(),
  minimumDelta: z.number().finite().min(0),
  required: z.boolean()
}).strict();

const evidenceSchema = z.object({
  kind: z.enum(['repository-metric', 'wolfram-verification', 'council-comparison', 'external']),
  evidenceDigest: z.string().min(1),
  sourceId: z.string().min(1).optional()
}).strict();

const observationSchema = z.object({
  metric: z.string().min(1),
  observed: z.number().finite(),
  evidence: evidenceSchema
}).passthrough();

const snapshotExperimentSchema = z.object({
  experimentId: z.string().min(1),
  goal: z.string().min(1),
  hypothesis: z.string().min(1),
  sourceCommit: z.string().min(1),
  metrics: z.array(metricSchema).min(1).max(12),
  parameters: z.record(z.string(), z.unknown()),
  observations: z.array(observationSchema).max(12)
}).passthrough();

export const multiExperimentSnapshotSchema = z.object({
  version: z.literal(1),
  experiments: z.array(snapshotExperimentSchema).max(200)
}).strict();

type Snapshot = z.infer<typeof multiExperimentSnapshotSchema>;

export function exportMultiExperimentSnapshot() {
  return {
    version: 1 as const,
    experiments: listMultiExperiments().map((experiment) => ({
      experimentId: experiment.experimentId,
      goal: experiment.goal,
      hypothesis: experiment.hypothesis,
      sourceCommit: experiment.sourceCommit,
      metrics: experiment.metrics,
      parameters: experiment.parameters,
      observations: experiment.observations.map((observation) => ({
        metric: observation.metric,
        observed: observation.observed,
        evidence: observation.evidence
      }))
    }))
  };
}

function assertExperimentAbsent(experimentId: string) {
  try {
    getMultiExperiment(experimentId);
    throw new Error(`Multi-metric experiment '${experimentId}' already exists.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown multi-metric experiment')) return;
    throw error;
  }
}

function preflightSnapshot(snapshot: Snapshot) {
  const ids = snapshot.experiments.map((item) => item.experimentId);
  if (new Set(ids).size !== ids.length) {
    throw new Error('Snapshot experiment ids must be unique.');
  }

  for (const item of snapshot.experiments) {
    assertExperimentAbsent(item.experimentId);

    const metricNames = item.metrics.map((metric) => metric.metric);
    if (new Set(metricNames).size !== metricNames.length) {
      throw new Error(`Snapshot experiment '${item.experimentId}' contains duplicate metric definitions.`);
    }

    const observationNames = item.observations.map((observation) => observation.metric);
    if (new Set(observationNames).size !== observationNames.length) {
      throw new Error(`Snapshot experiment '${item.experimentId}' contains duplicate observations.`);
    }

    const declared = new Set(metricNames);
    for (const observation of item.observations) {
      if (!declared.has(observation.metric)) {
        throw new Error(
          `Snapshot observation metric '${observation.metric}' is not declared by experiment '${item.experimentId}'.`
        );
      }
    }
  }
}

export function importMultiExperimentSnapshot(input: Snapshot) {
  const snapshot = multiExperimentSnapshotSchema.parse(input);
  preflightSnapshot(snapshot);
  const imported: string[] = [];

  for (const item of snapshot.experiments) {
    createMultiExperiment({
      experimentId: item.experimentId,
      goal: item.goal,
      hypothesis: item.hypothesis,
      sourceCommit: item.sourceCommit,
      metrics: item.metrics,
      parameters: item.parameters
    });

    for (const observation of item.observations) {
      observeMultiExperiment({
        experimentId: item.experimentId,
        metric: observation.metric,
        observed: observation.observed,
        evidence: observation.evidence
      });
    }
    imported.push(item.experimentId);
  }

  return {
    imported,
    count: imported.length,
    persistence: 'host-managed-json-snapshot',
    writes: false
  };
}

export function multiExperimentSnapshotLimits() {
  return {
    version: 1,
    maxExperiments: 200,
    storage: 'host-managed-json-snapshot',
    filesystemWrites: false,
    duplicatePolicy: 'reject-preflight'
  };
}
