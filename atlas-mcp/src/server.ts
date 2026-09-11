import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { getRepo, repos } from './registry.js';
import { runRepoAction } from './runner.js';
import { planMap3dRequest } from './map3d.js';
import { describeAtomModel } from './atoms.js';
import { getGame, listGames, listRulesets } from './games.js';
import {
  agentTaskInputSchema,
  cancelTask,
  getTaskResult,
  getTaskStatus,
  submitTask
} from './agents.js';
import {
  activeScheduleCount,
  createSchedule,
  disableSchedule,
  enableSchedule,
  getSchedule,
  listSchedules,
  removeSchedule,
  runScheduleNow,
  scheduleInputSchema,
  MAX_SCHEDULES
} from './scheduler.js';

serveStdio(() => {
  const server = new McpServer({ name: 'atlas-mcp', version: '0.1.0' });

  server.registerTool(
    'repos.list',
    {
      description: 'List Atlas-integrated repositories and their allowlisted actions.',
      inputSchema: z.object({ domain: z.enum(['mapping', 'physics', 'games', 'council', 'research']).optional() })
    },
    async ({ domain }) => {
      const items = repos
        .filter((repo) => !domain || repo.domain === domain)
        .map((repo) => ({
          id: repo.id,
          repo: repo.repo,
          domain: repo.domain,
          actions: Object.entries(repo.actions).map(([name, action]) => ({ name, description: action.description }))
        }));

      return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
    }
  );

  server.registerTool(
    'repos.run',
    {
      description: 'Run one explicitly allowlisted action in a registered local repository checkout.',
      inputSchema: z.object({
        repo: z.string().min(1),
        action: z.string().min(1)
      })
    },
    async ({ repo: repoId, action }) => {
      const repo = getRepo(repoId);
      if (!repo) {
        return { isError: true, content: [{ type: 'text', text: `Unknown repo '${repoId}'. Use repos.list first.` }] };
      }

      try {
        const result = await runRepoAction(repo, action);
        const failed = result.timedOut || result.exitCode !== 0;
        return {
          isError: failed,
          content: [{
            type: 'text',
            text: JSON.stringify({
              repo: result.repo,
              action: result.action,
              exitCode: result.exitCode,
              signal: result.signal,
              timedOut: result.timedOut,
              stdout: result.stdout,
              stderr: result.stderr
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'map3d.plan',
    {
      description: 'Validate a small geographic bounding box and produce the OpenStreetMap/Overpass request plan used by the Map3D reconstruction pipeline.',
      inputSchema: z.object({
        north: z.number().min(-90).max(90),
        south: z.number().min(-90).max(90),
        east: z.number().min(-180).max(180),
        west: z.number().min(-180).max(180)
      })
    },
    async (bounds) => {
      try {
        const plan = planMap3dRequest(bounds);
        return { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'atoms.describe',
    {
      description: 'Describe the current lightweight hydrogen/muonic-hydrogen visualization model state without invoking the browser renderer.',
      inputSchema: z.object({
        particle: z.enum(['electron', 'muon']),
        n: z.number().int().min(1).max(6),
        l: z.number().int().min(0).max(5),
        m: z.number().int().min(-5).max(5)
      })
    },
    async (input) => {
      try {
        const model = describeAtomModel(input);
        return { content: [{ type: 'text', text: JSON.stringify(model, null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'games.list',
    {
      description: 'List canonical Chess Atlas games in chronological order with provenance-facing metadata.',
      inputSchema: z.object({
        family: z.string().min(1).optional(),
        timelineOnly: z.boolean().optional()
      })
    },
    async (input) => {
      try {
        const games = await listGames(input);
        return { content: [{ type: 'text', text: JSON.stringify(games, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    }
  );

  server.registerTool(
    'games.get',
    {
      description: 'Get one canonical Chess Atlas game record by stable game id.',
      inputSchema: z.object({ gameId: z.string().min(1) })
    },
    async ({ gameId }) => {
      try {
        const game = await getGame(gameId);
        return { content: [{ type: 'text', text: JSON.stringify(game, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    }
  );

  server.registerTool(
    'games.rulesets',
    {
      description: 'List attributed Chess Atlas ruleset profiles, optionally restricted to one game id. Reconstruction status remains explicit.',
      inputSchema: z.object({ gameId: z.string().min(1).optional() })
    },
    async ({ gameId }) => {
      try {
        const rulesets = await listRulesets(gameId);
        return { content: [{ type: 'text', text: JSON.stringify(rulesets, null, 2) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
    }
  );

  server.registerTool(
    'agents.submit',
    {
      description: 'Create and start one bounded in-memory task using a predefined allowlisted repository action.',
      inputSchema: agentTaskInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(submitTask(input), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'agents.status',
    {
      description: 'Return metadata and current state for one in-memory Atlas task.',
      inputSchema: z.object({ taskId: z.string().min(1) }).strict()
    },
    async ({ taskId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getTaskStatus(taskId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'agents.result',
    {
      description: 'Return bounded output and result metadata after an Atlas task reaches a terminal state.',
      inputSchema: z.object({ taskId: z.string().min(1) }).strict()
    },
    async ({ taskId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getTaskResult(taskId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'agents.cancel',
    {
      description: 'Cancel a queued Atlas task; running subprocesses are not killed in v0.1.',
      inputSchema: z.object({ taskId: z.string().min(1) }).strict()
    },
    async ({ taskId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(cancelTask(taskId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'scheduler.create',
    {
      description: 'Create an enabled in-memory recurring schedule for a predefined bounded task.',
      inputSchema: scheduleInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(createSchedule(input), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'scheduler.list',
    {
      description: 'List in-memory Atlas schedules.',
      inputSchema: z.object({}).strict()
    },
    async () => ({ content: [{ type: 'text', text: JSON.stringify(listSchedules(), null, 2) }] })
  );

  server.registerTool(
    'scheduler.get',
    {
      description: 'Get one in-memory Atlas schedule.',
      inputSchema: z.object({ scheduleId: z.string().min(1) }).strict()
    },
    async ({ scheduleId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getSchedule(scheduleId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'scheduler.enable',
    {
      description: 'Enable one in-memory Atlas schedule and recalculate its next run.',
      inputSchema: z.object({ scheduleId: z.string().min(1) }).strict()
    },
    async ({ scheduleId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(enableSchedule(scheduleId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'scheduler.disable',
    {
      description: 'Disable one in-memory Atlas schedule and clear its timer.',
      inputSchema: z.object({ scheduleId: z.string().min(1) }).strict()
    },
    async ({ scheduleId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(disableSchedule(scheduleId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'scheduler.run_now',
    {
      description: 'Run one schedule immediately through agents.submit and the existing allowlisted task mapping.',
      inputSchema: z.object({ scheduleId: z.string().min(1) }).strict()
    },
    async ({ scheduleId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(runScheduleNow(scheduleId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'scheduler.remove',
    {
      description: 'Remove one in-memory Atlas schedule and clear its timer.',
      inputSchema: z.object({ scheduleId: z.string().min(1) }).strict()
    },
    async ({ scheduleId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(removeSchedule(scheduleId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'atlas.status',
    {
      description: 'Report Atlas MCP configuration and which repo root is active.',
      inputSchema: z.object({})
    },
    async () => ({
      content: [{
        type: 'text',
        text: JSON.stringify({
          version: '0.1.0',
          repoRootConfigured: Boolean(process.env.ATLAS_REPO_ROOT),
          registeredRepos: repos.length,
          executableActions: repos.reduce((sum, repo) => sum + Object.keys(repo.actions).length, 0),
          structuredTools: [
            'map3d.plan',
            'atoms.describe',
            'games.list',
            'games.get',
            'games.rulesets',
            'agents.submit',
            'agents.status',
            'agents.result',
            'agents.cancel',
            'scheduler.create',
            'scheduler.list',
            'scheduler.get',
            'scheduler.enable',
            'scheduler.disable',
            'scheduler.run_now',
            'scheduler.remove'
          ],
          scheduler: {
            supported: true,
            persistence: 'in-memory',
            activeSchedules: activeScheduleCount(),
            maxSchedules: MAX_SCHEDULES
          }
        }, null, 2)
      }]
    })
  );

  return server;
});
