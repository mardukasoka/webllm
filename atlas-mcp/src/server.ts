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
import {
  createDiagnostic,
  debuggerCreateInputSchema,
  getDiagnosticResult,
  getDiagnosticStatus
} from './debugger.js';
import {
  createInspection,
  getInspectionResult,
  getInspectionStatus,
  specialistInspectInputSchema,
  specialistLimits
} from './specialist.js';
import {
  councilPrepareReviewInputSchema,
  councilRecordProposalInputSchema,
  getReviewStatus,
  prepareReview,
  recordProposal
} from './council-review.js';
import { experimentStatus } from './experiments.js';
import { registerExperimentTools } from './experiment-tools.js';

serveStdio(() => {
  const server = new McpServer({ name: 'atlas-mcp', version: '0.1.0' });
  registerExperimentTools(server);

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
    'debugger.create',
    {
      description: 'Create a proposal-only diagnostic from one failed bounded Atlas task.',
      inputSchema: debuggerCreateInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(createDiagnostic(input), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'debugger.status',
    {
      description: 'Return the state and bounded evidence metadata for one in-memory diagnostic.',
      inputSchema: z.object({ diagnosticId: z.string().min(1) }).strict()
    },
    async ({ diagnosticId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getDiagnosticStatus(diagnosticId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'debugger.result',
    {
      description: 'Return a completed proposal-only diagnosis and remediation proposal.',
      inputSchema: z.object({ diagnosticId: z.string().min(1) }).strict()
    },
    async ({ diagnosticId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getDiagnosticResult(diagnosticId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'specialist.inspect',
    {
      description: 'Create a bounded read-only evidence packet from one completed debugger diagnostic.',
      inputSchema: specialistInspectInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(createInspection(input), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'specialist.status',
    {
      description: 'Return the state and metadata for one in-memory specialist inspection.',
      inputSchema: z.object({ inspectionId: z.string().min(1) }).strict()
    },
    async ({ inspectionId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getInspectionStatus(inspectionId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'specialist.result',
    {
      description: 'Return the completed bounded, read-only repository evidence packet.',
      inputSchema: z.object({ inspectionId: z.string().min(1) }).strict()
    },
    async ({ inspectionId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getInspectionResult(inspectionId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'council.prepare_review',
    {
      description: 'Prepare a bounded provenance-linked review packet from one completed specialist inspection.',
      inputSchema: councilPrepareReviewInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(prepareReview(input), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'council.review_status',
    {
      description: 'Return the state, provenance, digest, and bounded packet metadata for one in-memory Council review.',
      inputSchema: z.object({ reviewId: z.string().min(1) }).strict()
    },
    async ({ reviewId }) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(getReviewStatus(reviewId), null, 2) }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
        };
      }
    }
  );

  server.registerTool(
    'council.record_proposal',
    {
      description: 'Validate and store a proposal against one bounded Council review without applying or testing it.',
      inputSchema: councilRecordProposalInputSchema
    },
    async (input) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(recordProposal(input), null, 2) }] };
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
            'debugger.create',
            'debugger.status',
            'debugger.result',
            'specialist.inspect',
            'specialist.status',
            'specialist.result',
            'council.prepare_review',
            'council.review_status',
            'council.record_proposal',
            'experiments.create',
            'experiments.evaluate',
            'experiments.get',
            'experiments.list',
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
          },
          debugger: {
            supported: true,
            mode: 'proposal-only',
            persistence: 'in-memory',
            writes: false
          },
          specialist: {
            supported: true,
            mode: 'read-only',
            fileSelection: 'static-allowlist',
            writes: false,
            ...specialistLimits()
          },
          councilReview: {
            supported: true,
            mode: 'proposal-validation-only',
            inference: 'external',
            writes: false,
            maxProposalFiles: 4,
            maxProposalBytes: 40_000
          },
          experiments: experimentStatus()
        }, null, 2)
      }]
    })
  );

  return server;
});