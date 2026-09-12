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

export function importMultiExperimentSnapshot(input: Snapshot) {
  const snapshot = multiExperimentSnapshotSchema.parse(input);
  const imported: string[] = [];

  for (const item of snapshot.experiments) {
    try {
      getMultiExperiment(item.experimentId);
      throw new Error(`Multi-metric experiment '${item.experimentId}' already exists.`);
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith('Unknown multi-metric experiment')) throw error;
    }

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
    duplicatePolicy: 'reject'
  };
}
