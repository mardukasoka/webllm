import { randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { getRepo } from './registry.js';
import {
  getTaskResult,
  getTaskStatus,
  type AgentTaskResult,
  type AgentTaskStatus
} from './agents.js';

export const debuggerCreateInputSchema = z.object({
  taskId: z.string().min(1)
}).strict();

export type DebuggerCreateInput = z.infer<typeof debuggerCreateInputSchema>;
export type DiagnosticStatus = 'queued' | 'running' | 'completed' | 'failed';
export type DiagnosisCategory =
  | 'timeout'
  | 'test-failure'
  | 'lint-failure'
  | 'typecheck-failure'
  | 'execution-failure';

export type DiagnosticEvidence = {
  taskType: AgentTaskStatus['taskType'];
  action: string | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdoutSummary: string;
  stderrSummary: string;
  taskError: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type DiagnosticDiagnosis = {
  category: DiagnosisCategory;
  summary: string;
};

export type DiagnosticProposal = {
  action: string;
  recommendedNextStep: string;
  writeRequired: false;
};

export type Diagnostic = {
  id: string;
  sourceTaskId: string;
  repo: string;
  status: DiagnosticStatus;
  createdAt: string;
  finishedAt: string | null;
  evidence: DiagnosticEvidence;
  diagnosis: DiagnosticDiagnosis | null;
  proposal: DiagnosticProposal | null;
  confidence: 'high' | 'medium' | 'low' | null;
  limitations: string[];
};

const diagnostics = new Map<string, Diagnostic>();
const MAX_SUMMARY_LENGTH = 4_000;

function now(): string {
  return new Date().toISOString();
}

function summarize(value: string): string {
  if (value.length <= MAX_SUMMARY_LENGTH) return value;
  const half = Math.floor(MAX_SUMMARY_LENGTH / 2);
  return `${value.slice(0, half)}\n...[bounded summary truncated]...\n${value.slice(-half)}`;
}

function snapshot(diagnostic: Diagnostic): Diagnostic {
  return {
    ...diagnostic,
    evidence: { ...diagnostic.evidence },
    diagnosis: diagnostic.diagnosis ? { ...diagnostic.diagnosis } : null,
    proposal: diagnostic.proposal ? { ...diagnostic.proposal } : null,
    limitations: [...diagnostic.limitations]
  };
}

function captureEvidence(taskId: string): {
  task: AgentTaskStatus;
  result: { result: AgentTaskResult | null; error: string | null };
  evidence: DiagnosticEvidence;
} {
  const task = getTaskStatus(taskId);

  if (task.status === 'cancelled') {
    throw new Error(`Task '${taskId}' is cancelled; cancelled tasks cannot be diagnosed.`);
  }
  if (task.status === 'completed') {
    throw new Error(`Task '${taskId}' completed successfully; only failed tasks can be diagnosed.`);
  }
  if (task.status !== 'failed') {
    throw new Error(`Task '${taskId}' is not terminal (status: ${task.status}).`);
  }
  if (!getRepo(task.repo)) {
    throw new Error(`Repository '${task.repo}' is not supported for diagnostics.`);
  }

  const result = getTaskResult(taskId);
  const taskResult = result.result;
  return {
    task,
    result,
    evidence: {
      taskType: task.taskType,
      action: taskResult?.action ?? null,
      exitCode: taskResult?.exitCode ?? null,
      signal: taskResult?.signal ?? null,
      timedOut: taskResult?.timedOut ?? false,
      stdoutSummary: summarize(taskResult?.stdout ?? ''),
      stderrSummary: summarize(taskResult?.stderr ?? ''),
      taskError: result.error ?? task.error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt
    }
  };
}

function hasTestFailureMarkers(evidence: DiagnosticEvidence): boolean {
  return /\bFAIL\b|\bfailed\b|AssertionError|\bexpected\b|\breceived\b/i.test(
    `${evidence.stdoutSummary}\n${evidence.stderrSummary}`
  );
}

function classify(evidence: DiagnosticEvidence): {
  diagnosis: DiagnosticDiagnosis;
  proposal: DiagnosticProposal;
  confidence: 'high' | 'medium' | 'low';
} {
  if (evidence.timedOut) {
    return {
      diagnosis: {
        category: 'timeout',
        summary: 'The allowlisted action exceeded its configured timeout.'
      },
      proposal: {
        action: 'review-timeout',
        recommendedNextStep: 'Review whether the bounded timeout is appropriate before rerunning the allowlisted action.',
        writeRequired: false
      },
      confidence: 'high'
    };
  }

  if (evidence.taskType === 'lint' && evidence.exitCode !== 0) {
    return {
      diagnosis: {
        category: 'lint-failure',
        summary: 'The allowlisted lint action exited non-zero.'
      },
      proposal: {
        action: 'review-lint-errors',
        recommendedNextStep: 'Review the bounded lint output and implementation before proposing a code change.',
        writeRequired: false
      },
      confidence: 'medium'
    };
  }

  if (evidence.taskType === 'typecheck' && evidence.exitCode !== 0) {
    return {
      diagnosis: {
        category: 'typecheck-failure',
        summary: 'The allowlisted typecheck action exited non-zero.'
      },
      proposal: {
        action: 'review-type-errors',
        recommendedNextStep: 'Review the bounded type errors and implementation before proposing a code change.',
        writeRequired: false
      },
      confidence: 'medium'
    };
  }

  if (evidence.exitCode !== 0 && hasTestFailureMarkers(evidence)) {
    return {
      diagnosis: {
        category: 'test-failure',
        summary: 'The bounded output contains recognizable test failure markers.'
      },
      proposal: {
        action: 'inspect-test-failure',
        recommendedNextStep: 'Inspect the failing test and implementation before proposing a code patch.',
        writeRequired: false
      },
      confidence: 'medium'
    };
  }

  return {
    diagnosis: {
      category: 'execution-failure',
      summary: 'The allowlisted action failed, but the bounded evidence is insufficient to identify a more specific category.'
    },
    proposal: {
      action: 'inspect-execution-failure',
      recommendedNextStep: 'Review the bounded task evidence before deciding whether a rerun or code investigation is appropriate.',
      writeRequired: false
    },
    confidence: 'low'
  };
}

function completeDiagnostic(diagnosticId: string): void {
  const diagnostic = diagnostics.get(diagnosticId);
  if (!diagnostic || diagnostic.status !== 'queued') return;

  diagnostic.status = 'running';
  try {
    const classification = classify(diagnostic.evidence);
    diagnostic.diagnosis = classification.diagnosis;
    diagnostic.proposal = classification.proposal;
    diagnostic.confidence = classification.confidence;
    diagnostic.limitations = [
      'No repository files were inspected.',
      'No code was modified.',
      'No Git operation was performed.',
      'No remote model was invoked.',
      'No automatic retry or remediation was executed.'
    ];
    diagnostic.status = 'completed';
  } catch (error) {
    diagnostic.status = 'failed';
    diagnostic.limitations = [
      'The diagnostic classifier failed before producing a proposal.',
      'No repository files were inspected.',
      'No code was modified.',
      'No Git operation was performed.'
    ];
    diagnostic.proposal = {
      action: 'inspect-diagnostic-failure',
      recommendedNextStep: error instanceof Error ? error.message : String(error),
      writeRequired: false
    };
    diagnostic.confidence = 'low';
  }
  diagnostic.finishedAt = now();
}

export function createDiagnostic(input: DebuggerCreateInput): Diagnostic {
  const { task, evidence } = captureEvidence(input.taskId);
  const diagnostic: Diagnostic = {
    id: randomUUID(),
    sourceTaskId: task.id,
    repo: task.repo,
    status: 'queued',
    createdAt: now(),
    finishedAt: null,
    evidence,
    diagnosis: null,
    proposal: null,
    confidence: null,
    limitations: [
      'Diagnostic is advisory only and has not executed remediation.'
    ]
  };

  diagnostics.set(diagnostic.id, diagnostic);
  const timer = setTimeout(() => completeDiagnostic(diagnostic.id), 0);
  timer.unref?.();
  return snapshot(diagnostic);
}

export function getDiagnosticStatus(diagnosticId: string): Diagnostic {
  const diagnostic = diagnostics.get(diagnosticId);
  if (!diagnostic) throw new Error(`Unknown diagnostic id '${diagnosticId}'.`);
  return snapshot(diagnostic);
}

export function getDiagnosticResult(diagnosticId: string): Diagnostic {
  const diagnostic = diagnostics.get(diagnosticId);
  if (!diagnostic) throw new Error(`Unknown diagnostic id '${diagnosticId}'.`);
  if (diagnostic.status === 'queued' || diagnostic.status === 'running') {
    throw new Error(`Diagnostic '${diagnosticId}' is not complete (status: ${diagnostic.status}).`);
  }
  return snapshot(diagnostic);
}