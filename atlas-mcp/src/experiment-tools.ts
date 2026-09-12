import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  comparisonExperimentInputSchema,
  evaluateExperimentFromComparison
} from './comparison-experiment.js';
import {
  createExperiment,
  evaluateStoredExperiment,
  experimentEvaluateInputSchema,
  experimentPlanInputSchema,
  getExperiment,
  listExperiments
} from './experiments.js';
import {
  createMultiExperiment,
  getMultiExperiment,
  listMultiExperiments,
  multiExperimentCreateInputSchema,
  multiExperimentObserveInputSchema,
  observeMultiExperiment
} from './multi-experiments.js';
import {
  evaluateExperimentFromRepositoryTask,
  repositoryMetricInputSchema
} from './repository-metrics.js';
import {
  evaluateExperimentFromWolfram,
  wolframExperimentInputSchema
} from './wolfram-verification.js';

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: error instanceof Error ? error.message : String(error)
    }]
  };
}

const experimentEvaluationInputSchema = z.union([
  experimentEvaluateInputSchema,
  comparisonExperimentInputSchema,
  wolframExperimentInputSchema,
  repositoryMetricInputSchema
]);

export function registerExperimentTools(server: McpServer) {
  server.registerTool(
    'experiments.create',
    {
      description: 'Create one bounded in-memory experiment plan with an explicit metric and no execution or repository writes.',
      inputSchema: experimentPlanInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(createExperiment(input), null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'experiments.evaluate',
    {
      description: 'Evaluate one stored experiment from a direct external metric, Council comparison, Wolfram verification, or deterministic bounded repository task evidence; records keep, reject, or inconclusive without applying changes.',
      inputSchema: experimentEvaluationInputSchema
    },
    async (input) => {
      try {
        const result = 'repositoryTask' in input
          ? evaluateExperimentFromRepositoryTask(input)
          : 'wolfram' in input
            ? evaluateExperimentFromWolfram(input)
            : 'comparison' in input
              ? evaluateExperimentFromComparison(input)
              : evaluateStoredExperiment(input);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'experiments.get',
    {
      description: 'Get one in-memory experiment plan or evaluated record by id, including bounded provenance evidence when attached.',
      inputSchema: z.object({ experimentId: z.string().min(1) }).strict()
    },
    async ({ experimentId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getExperiment(experimentId), null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'experiments.list',
    {
      description: 'List all bounded in-memory experiment plans and evaluated records.',
      inputSchema: z.object({}).strict()
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(listExperiments(), null, 2) }]
    })
  );

  server.registerTool(
    'experiments.multi_create',
    {
      description: 'Create a bounded in-memory multi-metric experiment with explicit per-metric baselines, directions, thresholds, and required flags.',
      inputSchema: multiExperimentCreateInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(createMultiExperiment(input), null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'experiments.multi_observe',
    {
      description: 'Attach one bounded metric observation and evidence reference to a multi-metric experiment; no metric may be observed twice.',
      inputSchema: multiExperimentObserveInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(observeMultiExperiment(input), null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'experiments.multi_get',
    {
      description: 'Get one multi-metric experiment with per-metric observations and rule-based overall disposition.',
      inputSchema: z.object({ experimentId: z.string().min(1) }).strict()
    },
    async ({ experimentId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getMultiExperiment(experimentId), null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'experiments.multi_list',
    {
      description: 'List bounded in-memory multi-metric experiments.',
      inputSchema: z.object({}).strict()
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(listMultiExperiments(), null, 2) }]
    })
  );
}
