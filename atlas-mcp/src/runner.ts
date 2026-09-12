import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type { RepoDefinition } from './registry.js';

export type RunResult = {
  repo: string;
  action: string;
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export async function runRepoAction(repo: RepoDefinition, actionName: string): Promise<RunResult> {
  const action = repo.actions[actionName];
  if (!action) throw new Error(`Action '${actionName}' is not registered for '${repo.id}'.`);

  const repoRoot = process.env.ATLAS_REPO_ROOT;
  if (!repoRoot) throw new Error('ATLAS_REPO_ROOT is not set. Point it at a directory containing the registered repo checkouts.');

  const cwd = path.resolve(repoRoot, repo.relativePath);
  const root = path.resolve(repoRoot) + path.sep;
  if (!cwd.startsWith(root)) throw new Error('Resolved repo path escaped ATLAS_REPO_ROOT.');
  await access(cwd);

  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(action.command, action.args, {
      cwd,
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const limit = 250_000;
    const append = (current: string, chunk: Buffer) => (current + chunk.toString('utf8')).slice(-limit);

    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.on('error', reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, action.timeoutMs ?? 60_000);

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ repo: repo.id, action: actionName, cwd, exitCode, signal, stdout, stderr, timedOut });
    });
  });
}
