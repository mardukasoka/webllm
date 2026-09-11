import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import {
  agentTaskInputSchema,
  getTaskResult,
  getTaskStatus,
  submitTask,
  validateTaskInput,
  watchTask,
  type AgentTaskInput,
  type AgentTaskStatus,
  type TaskStatus
} from './agents.js';

export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 10080;
export const MAX_SCHEDULES = 20;

export const scheduleInputSchema = agentTaskInputSchema.extend({
  name: z.string().min(1).max(120),
  intervalMinutes: z.number().int().min(MIN_INTERVAL_MINUTES).max(MAX_INTERVAL_MINUTES)
}).strict();

export type ScheduleInput = z.infer<typeof scheduleInputSchema>;
export type ScheduleStatus = TaskStatus | 'skipped';

export type Schedule = {
  id: string;
  name: string;
  enabled: boolean;
  taskType: AgentTaskInput['taskType'];
  repo: string;
  writeMode: AgentTaskInput['writeMode'];
  maxAgents: number;
  timeoutMinutes: number;
  intervalMinutes: number;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastTaskId: string | null;
  lastStatus: ScheduleStatus | null;
  lastSkipReason: string | null;
  lastError: string | null;
  lastExitCode: number | null;
  lastStderrSummary: string | null;
};

type Timer = ReturnType<typeof setTimeout>;

const schedules = new Map<string, Schedule>();
const timers = new Map<string, Timer>();

function now(): string {
  return new Date().toISOString();
}

function nextRunAt(intervalMinutes: number): string {
  return new Date(Date.now() + intervalMinutes * 60_000).toISOString();
}

function snapshot(schedule: Schedule): Schedule {
  return { ...schedule };
}

function clearScheduleTimer(scheduleId: string): void {
  const timer = timers.get(scheduleId);
  if (!timer) return;
  clearTimeout(timer);
  timers.delete(scheduleId);
}

function armScheduleTimer(schedule: Schedule): void {
  clearScheduleTimer(schedule.id);
  if (!schedule.enabled || !schedule.nextRunAt) return;

  const delay = Math.max(0, new Date(schedule.nextRunAt).getTime() - Date.now());
  const timer = setTimeout(() => {
    timers.delete(schedule.id);
    const current = schedules.get(schedule.id);
    if (!current || !current.enabled) return;
    runScheduledOccurrence(current);
  }, delay);
  timer.unref?.();
  timers.set(schedule.id, timer);
}

function updateFromTask(schedule: Schedule, taskId: string): void {
  const current = schedules.get(schedule.id);
  if (!current || current.lastTaskId !== taskId || current.lastStatus === 'skipped') return;

  const status: AgentTaskStatus = getTaskStatus(taskId);
  current.lastStatus = status.status;
  current.lastError = status.error;
  current.lastExitCode = status.result?.exitCode ?? null;

  try {
    const result = getTaskResult(taskId);
    current.lastStderrSummary = result.result?.stderr.slice(-2_000) || null;
  } catch {
    current.lastStderrSummary = null;
  }
}

function observeTask(schedule: Schedule, taskId: string): void {
  watchTask(taskId, () => updateFromTask(schedule, taskId));
}

function startOccurrence(schedule: Schedule): { taskId: string | null; skipped: boolean; reason?: string } {
  const previousTaskId = schedule.lastTaskId;
  if (previousTaskId) {
    const previousStatus = getTaskStatus(previousTaskId).status;
    if (previousStatus === 'queued' || previousStatus === 'running') {
      const reason = 'Previous scheduled task is still running; occurrence skipped.';
      schedule.lastRunAt = now();
      schedule.lastStatus = 'skipped';
      schedule.lastSkipReason = reason;
      schedule.lastError = null;
      schedule.lastExitCode = null;
      schedule.lastStderrSummary = null;
      return { taskId: null, skipped: true, reason };
    }
  }

  const task = submitTask({
    taskType: schedule.taskType,
    repo: schedule.repo,
    writeMode: schedule.writeMode,
    maxAgents: schedule.maxAgents,
    timeoutMinutes: schedule.timeoutMinutes
  });
  schedule.lastRunAt = now();
  schedule.lastTaskId = task.id;
  schedule.lastStatus = task.status;
  schedule.lastSkipReason = null;
  schedule.lastError = null;
  schedule.lastExitCode = null;
  schedule.lastStderrSummary = null;
  observeTask(schedule, task.id);
  return { taskId: task.id, skipped: false };
}

function runScheduledOccurrence(schedule: Schedule): void {
  startOccurrence(schedule);
  if (schedule.enabled) {
    schedule.nextRunAt = nextRunAt(schedule.intervalMinutes);
    armScheduleTimer(schedule);
  }
}

export function createSchedule(input: ScheduleInput): Schedule {
  if (schedules.size >= MAX_SCHEDULES) {
    throw new Error(`Maximum of ${MAX_SCHEDULES} schedules reached.`);
  }
  validateTaskInput(input);

  const schedule: Schedule = {
    id: randomUUID(),
    name: input.name,
    enabled: true,
    taskType: input.taskType,
    repo: input.repo,
    writeMode: input.writeMode,
    maxAgents: input.maxAgents,
    timeoutMinutes: input.timeoutMinutes,
    intervalMinutes: input.intervalMinutes,
    createdAt: now(),
    lastRunAt: null,
    nextRunAt: nextRunAt(input.intervalMinutes),
    lastTaskId: null,
    lastStatus: null,
    lastSkipReason: null,
    lastError: null,
    lastExitCode: null,
    lastStderrSummary: null
  };

  schedules.set(schedule.id, schedule);
  armScheduleTimer(schedule);
  return snapshot(schedule);
}

export function listSchedules(): Schedule[] {
  return [...schedules.values()].map(snapshot);
}

export function getSchedule(scheduleId: string): Schedule {
  const schedule = schedules.get(scheduleId);
  if (!schedule) throw new Error(`Unknown schedule id '${scheduleId}'.`);
  return snapshot(schedule);
}

export function enableSchedule(scheduleId: string): Schedule {
  const schedule = schedules.get(scheduleId);
  if (!schedule) throw new Error(`Unknown schedule id '${scheduleId}'.`);
  schedule.enabled = true;
  schedule.nextRunAt = nextRunAt(schedule.intervalMinutes);
  armScheduleTimer(schedule);
  return snapshot(schedule);
}

export function disableSchedule(scheduleId: string): Schedule {
  const schedule = schedules.get(scheduleId);
  if (!schedule) throw new Error(`Unknown schedule id '${scheduleId}'.`);
  schedule.enabled = false;
  schedule.nextRunAt = null;
  clearScheduleTimer(schedule.id);
  return snapshot(schedule);
}

export function runScheduleNow(scheduleId: string): {
  schedule: Schedule;
  taskId: string | null;
  skipped: boolean;
  reason?: string;
} {
  const schedule = schedules.get(scheduleId);
  if (!schedule) throw new Error(`Unknown schedule id '${scheduleId}'.`);

  const occurrence = startOccurrence(schedule);
  if (schedule.enabled) {
    schedule.nextRunAt = schedule.nextRunAt ?? nextRunAt(schedule.intervalMinutes);
    armScheduleTimer(schedule);
  }

  return {
    schedule: snapshot(schedule),
    ...occurrence
  };
}

export function removeSchedule(scheduleId: string): { removed: true; scheduleId: string } {
  const schedule = schedules.get(scheduleId);
  if (!schedule) throw new Error(`Unknown schedule id '${scheduleId}'.`);
  clearScheduleTimer(schedule.id);
  schedules.delete(schedule.id);
  return { removed: true, scheduleId };
}

export function activeScheduleCount(): number {
  return [...schedules.values()].filter(schedule => schedule.enabled).length;
}