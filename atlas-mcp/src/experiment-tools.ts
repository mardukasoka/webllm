import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  createExperiment,
  evaluateStoredExperiment,
  experimentEvaluateInputSchema,
  experimentPlanInputSchema,
  getExperiment,
  listExperiments
} from './experiments.js';

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: error instanceof Error ? error.message : String(error)
    }]
  };
}

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
      description: 'Evaluate one stored experiment from an externally observed metric and record keep, reject, or inconclusive.',
      inputSchema: experimentEvaluateInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(evaluateStoredExperiment(input), null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'experiments.get',
    {
      description: 'Get one in-memory experiment plan or evaluated record by id.',
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
}
