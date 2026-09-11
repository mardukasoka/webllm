import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { getRepo, repos } from './registry.js';
import { runRepoAction } from './runner.js';

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
          executableActions: repos.reduce((sum, repo) => sum + Object.keys(repo.actions).length, 0)
        }, null, 2)
      }]
    })
  );

  return server;
});
