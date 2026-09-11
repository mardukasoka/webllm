export type RepoAction = {
  description: string;
  command: string;
  args: string[];
  timeoutMs?: number;
};

export type RepoDefinition = {
  id: string;
  repo: string;
  relativePath: string;
  domain: 'mapping' | 'physics' | 'games' | 'council' | 'research';
  actions: Record<string, RepoAction>;
};

export const repos: RepoDefinition[] = [
  {
    id: 'map3d',
    repo: 'mardukasoka/map3d',
    relativePath: 'map3d',
    domain: 'mapping',
    actions: {
      build: {
        description: 'Type-check and build the Map3D application.',
        command: 'npm',
        args: ['run', 'build'],
        timeoutMs: 120000
      }
    }
  },
  {
    id: 'webllm',
    repo: 'mardukasoka/webllm',
    relativePath: 'webllm',
    domain: 'council',
    actions: {
      test: {
        description: 'Run the WebLLM/Council Vitest suite.',
        command: 'npm',
        args: ['test'],
        timeoutMs: 120000
      },
      lint: {
        description: 'Run the WebLLM/Council ESLint checks.',
        command: 'npm',
        args: ['run', 'lint'],
        timeoutMs: 120000
      }
    }
  },
  {
    id: 'chess-atlas',
    repo: 'mardukasoka/chess-atlas',
    relativePath: 'chess-atlas',
    domain: 'games',
    actions: {
      catalog: {
        description: 'Read the canonical Chess Atlas game registry as JSON without starting the UI.',
        command: 'node',
        args: [
          '-e',
          "const r=require('./game-registry.js'); console.log(JSON.stringify(r.chronologicalGames(), null, 2));"
        ],
        timeoutMs: 15000
      }
    }
  },
  {
    id: 'atoms',
    repo: 'mardukasoka/Atoms',
    relativePath: 'Atoms',
    domain: 'physics',
    actions: {}
  }
];

export function getRepo(id: string): RepoDefinition | undefined {
  return repos.find((repo) => repo.id === id);
}
