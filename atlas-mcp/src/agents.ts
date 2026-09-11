import { randomUUID } from 'node:crypto';
import { getRepo, type RepoDefinition } from './registry.js';
import { runRepoAction, type RunResult } from './runner.js';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskType = 'test' | 'lint' | 'typecheck' | 'debug' | 'audit';
export type WriteMode = 'read-only' | 'branch-only';

export type AgentTaskResult = {
  repo: string;
  action: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

export type AgentTask = {
  id: string;
  taskType: TaskType;
  repo: string;
  status: TaskStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  writeMode: WriteMode;
  maxAgents: number;
  timeoutMinutes: number;
  result: AgentTaskResult | null;
  error: string | null;
};

export type AgentTaskInput = {
  taskType: TaskType;
  repo: string;
  writeMode: WriteMode;
  maxAgents: number;
  timeoutMinutes: number;
};

type TaskAction = {
  repo: RepoDefinition;
  action: string;
};

type AgentTaskStatus = Omit<AgentTask, 'result'> & {
  result: {
    available: true;
    repo: string;
    action: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
  } | null;
};

const tasks = new Map<string, AgentTask>();

const actionMappings: Partial<Record<TaskType, Partial<Record<string, string>>>> = {
  test: { webllm: 'test' },
  lint: { webllm: 'lint' },
  audit: { 'chess-atlas': 'catalog' }
};

function now(): string {
  return new Date().toISOString();
}

function resolveTaskAction(taskType: TaskType, repoId: string): TaskAction {
  const repo = getRepo(repoId);
  if (!repo) throw new Error(`Unknown Atlas repository '${repoId}'. Use repos.list first.`);

  const action = actionMappings[taskType]?.[repo.id];
  if (!action || !repo.actions[action]) {
    throw new Error(`No safe allowlisted mapping exists for taskType '${taskType}' and repo '${repo.id}'.`);
  }

  return { repo, action };
}

function getTask(taskId: string): AgentTask {
  const task = tasks.get(taskId);
  if (!task) throw new Error(`Unknown task id '${taskId}'.`);
  return task;
}

function taskStatus(task: AgentTask): AgentTaskStatus {
  const result = task.result
    ? {
        available: true as const,
        repo: task.result.repo,
        action: task.result.action,
        exitCode: task.result.exitCode,
        signal: task.result.signal,
        timedOut: task.result.timedOut
      }
    : null;

  return {
    id: task.id,
    taskType: task.taskType,
    repo: task.repo,
    status: task.status,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    writeMode: task.writeMode,
    maxAgents: task.maxAgents,
    timeoutMinutes: task.timeoutMinutes,
    result,
    error: task.error
  };
}

function storeRunResult(task: AgentTask, result: RunResult): void {
  task.result = {
    repo: result.repo,
    action: result.action,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr
  };

  const failed = result.timedOut || result.exitCode !== 0;
  task.status = failed ? 'failed' : 'completed';
  task.error = failed
    ? result.timedOut
      ? 'Allowlisted action timed out.'
      : `Allowlisted action exited with code ${result.exitCode}.`
    : null;
  task.finishedAt = now();
}

async function executeTask(taskId: string, action: TaskAction): Promise<void> {
  const task = getTask(taskId);
  if (task.status !== 'queued') return;

  task.status = 'running';
  task.startedAt = now();

  try {
    const result = await runRepoAction(action.repo, action.action);
    storeRunResult(task, result);
  } catch (error) {
    task.status = 'failed';
    task.error = error instanceof Error ? error.message : String(error);
    task.finishedAt = now();
  }
}

export function submitTask(input: AgentTaskInput): AgentTaskStatus {
  const action = resolveTaskAction(input.taskType, input.repo);
  const task: AgentTask = {
    id: randomUUID(),
    taskType: input.taskType,
    repo: action.repo.id,
    status: 'queued',
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    writeMode: input.writeMode,
    maxAgents: input.maxAgents,
    timeoutMinutes: input.timeoutMinutes,
    result: null,
    error: null
  };

  tasks.set(task.id, task);
  setTimeout(() => {
    void executeTask(task.id, action);
  }, 0);

  return taskStatus(task);
}

export function getTaskStatus(taskId: string): AgentTaskStatus {
  return taskStatus(getTask(taskId));
}

export function getTaskResult(taskId: string): {
  id: string;
  status: TaskStatus;
  result: AgentTaskResult | null;
  error: string | null;
} {
  const task = getTask(taskId);
  if (task.status === 'queued' || task.status === 'running') {
    throw new Error(`Task '${taskId}' is not complete (status: ${task.status}).`);
  }

  return {
    id: task.id,
    status: task.status,
    result: task.result,
    error: task.error
  };
}

export function cancelTask(taskId: string): {
  cancelled: boolean;
  limitation?: string;
  task: AgentTaskStatus;
} {
  const task = getTask(taskId);

  if (task.status === 'queued') {
    task.status = 'cancelled';
    task.error = 'Task cancelled before execution.';
    task.finishedAt = now();
    return { cancelled: true, task: taskStatus(task) };
  }

  if (task.status === 'running') {
    return {
      cancelled: false,
      limitation: 'Task is already running; v0.1 does not kill active subprocesses.',
      task: taskStatus(task)
    };
  }

  return { cancelled: false, task: taskStatus(task) };
}