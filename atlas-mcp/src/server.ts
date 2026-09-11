import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { getRepo, repos } from './registry.js';
import { runRepoAction } from './runner.js';
import { planMap3dRequest } from './map3d.js';
import { describeAtomModel } from './atoms.js';
import { getGame, listGames, listRulesets } from './games.js';
import { cancelTask, getTaskResult, getTaskStatus, submitTask } from './agents.js';

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
      inputSchema: z.object({
        taskType: z.enum(['test', 'lint', 'typecheck', 'debug', 'audit']),
        repo: z.string().min(1),
        writeMode: z.enum(['read-only', 'branch-only']),
        maxAgents: z.number().int().min(1).max(4),
        timeoutMinutes: z.number().int().min(1).max(60)
      }).strict()
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
            'agents.cancel'
          ]
        }, null, 2)
      }]
    })
  );

  return server;
});
