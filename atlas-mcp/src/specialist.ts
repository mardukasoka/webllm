import { randomUUID } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import * as z from 'zod/v4';
import { getRepo } from './registry.js';
import {
  getTaskStatus
} from './agents.js';
import {
  getDiagnosticResult,
  type DiagnosisCategory,
  type Diagnostic
} from './debugger.js';

export const specialistInspectInputSchema = z.object({
  diagnosticId: z.string().min(1)
}).strict();

export const MAX_FILES_PER_INSPECTION = 6;
export const MAX_FILE_BYTES = 20_000;
export const MAX_TOTAL_BYTES = 60_000;

export type SpecialistInspectInput = z.infer<typeof specialistInspectInputSchema>;
export type InspectionStatus = 'queued' | 'running' | 'completed' | 'failed';

export type InspectionFile = {
  path: string;
  bytesRead: number;
  truncated: boolean;
  content: string;
};

export type InspectionEvidence = {
  diagnosticCategory: DiagnosisCategory;
  diagnosticSummary: string;
  sourceTaskId: string;
  stdoutSummary: string;
  stderrSummary: string;
  files: InspectionFile[];
};

export type SpecialistRecommendation = {
  action: string;
  summary: string;
  patchProposed: false;
};

export type Inspection = {
  id: string;
  diagnosticId: string;
  sourceTaskId: string;
  repo: string;
  status: InspectionStatus;
  createdAt: string;
  finishedAt: string | null;
  filesRequested: string[];
  filesRead: string[];
  evidence: InspectionEvidence | null;
  recommendation: SpecialistRecommendation | null;
  limitations: string[];
};

type StaticInspectionPlan = {
  files: readonly string[];
  available: boolean;
};

const inspections = new Map<string, Inspection>();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

const staticFileAllowlist: Record<string, Partial<Record<DiagnosisCategory, readonly string[]>>> = {
  webllm: {
    'test-failure': [
      'tests/models.test.js',
      'tests/sessions.test.js',
      'lib/models.js',
      'lib/sessions.js'
    ]
  }
};

function now(): string {
  return new Date().toISOString();
}

function snapshot(inspection: Inspection): Inspection {
  return {
    ...inspection,
    filesRequested: [...inspection.filesRequested],
    filesRead: [...inspection.filesRead],
    evidence: inspection.evidence
      ? {
          ...inspection.evidence,
          files: inspection.evidence.files.map((file) => ({ ...file }))
        }
      : null,
    recommendation: inspection.recommendation
      ? { ...inspection.recommendation }
      : null,
    limitations: [...inspection.limitations]
  };
}

function getPlan(diagnostic: Diagnostic): StaticInspectionPlan {
  const files = staticFileAllowlist[diagnostic.repo]?.[diagnostic.diagnosis?.category ?? 'execution-failure'] ?? [];
  return {
    files: files.slice(0, MAX_FILES_PER_INSPECTION),
    available: files.length > 0
  };
}

function assertContained(candidate: string, root: string): void {
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!candidate.startsWith(rootPrefix)) {
    throw new Error('Resolved specialist file escaped the registered repository root.');
  }
}

function decodeUtf8(buffer: Buffer): string {
  for (let length = buffer.length; length >= Math.max(0, buffer.length - 3); length -= 1) {
    try {
      return utf8Decoder.decode(buffer.subarray(0, length));
    } catch {
      // A valid UTF-8 file may end the bounded excerpt in the middle of a code point.
    }
  }
  throw new Error('Allowlisted specialist file is not valid UTF-8 text.');
}

async function readAllowlistedFile(
  repoId: string,
  relativeFile: string,
  remainingBytes: number
): Promise<InspectionFile> {
  const repo = getRepo(repoId);
  if (!repo) throw new Error(`Repository '${repoId}' is not registered.`);

  const atlasRoot = process.env.ATLAS_REPO_ROOT;
  if (!atlasRoot) throw new Error('ATLAS_REPO_ROOT is not set.');

  const registeredRoot = path.resolve(atlasRoot, repo.relativePath);
  const registeredRootReal = await realpath(registeredRoot);
  const candidate = path.resolve(registeredRoot, relativeFile);
  assertContained(candidate, registeredRoot);

  const candidateStat = await lstat(candidate);
  if (!candidateStat.isFile()) {
    throw new Error(`Allowlisted specialist path is not a regular file: '${relativeFile}'.`);
  }

  const candidateReal = await realpath(candidate);
  assertContained(candidateReal, registeredRootReal);
  const readLimit = Math.min(MAX_FILE_BYTES, Math.max(0, remainingBytes));
  if (readLimit === 0) {
    return { path: relativeFile, bytesRead: 0, truncated: true, content: '' };
  }

  const handle = await open(candidateReal, 'r');
  try {
    const buffer = Buffer.alloc(readLimit);
    const { bytesRead } = await handle.read(buffer, 0, readLimit, 0);
    const truncated = candidateStat.size > bytesRead;
    const content = decodeUtf8(buffer.subarray(0, bytesRead));
    return { path: relativeFile, bytesRead, truncated, content };
  } finally {
    await handle.close();
  }
}

async function readAllowlistedFiles(repoId: string, files: readonly string[]): Promise<{
  files: InspectionFile[];
  filesRead: string[];
}> {
  const evidenceFiles: InspectionFile[] = [];
  const filesRead: string[] = [];
  let totalBytes = 0;

  for (const relativeFile of files) {
    const file = await readAllowlistedFile(repoId, relativeFile, MAX_TOTAL_BYTES - totalBytes);
    evidenceFiles.push(file);
    filesRead.push(relativeFile);
    totalBytes += file.bytesRead;
  }

  return { files: evidenceFiles, filesRead };
}

function recommendationFor(diagnostic: Diagnostic, available: boolean): SpecialistRecommendation {
  if (!available) {
    return {
      action: 'inspection-unavailable',
      summary: 'Inspection unavailable for this diagnostic category.',
      patchProposed: false
    };
  }

  if (diagnostic.diagnosis?.category === 'test-failure') {
    return {
      action: 'review-webllm-test-failure',
      summary: 'The verified failing tests and associated model/session implementations are available for Council review.',
      patchProposed: false
    };
  }

  return {
    action: 'review-bounded-evidence',
    summary: 'The allowlisted repository evidence is available for Council review.',
    patchProposed: false
  };
}

async function completeInspection(inspectionId: string, diagnostic: Diagnostic, plan: StaticInspectionPlan): Promise<void> {
  const inspection = inspections.get(inspectionId);
  if (!inspection || inspection.status !== 'queued') return;

  inspection.status = 'running';
  try {
    const files = await readAllowlistedFiles(diagnostic.repo, plan.files);
    inspection.filesRead = files.filesRead;
    inspection.evidence = {
      diagnosticCategory: diagnostic.diagnosis!.category,
      diagnosticSummary: diagnostic.diagnosis!.summary,
      sourceTaskId: diagnostic.sourceTaskId,
      stdoutSummary: diagnostic.evidence.stdoutSummary,
      stderrSummary: diagnostic.evidence.stderrSummary,
      files: files.files
    };
    inspection.recommendation = recommendationFor(diagnostic, plan.available);
    inspection.limitations = [
      'Files were selected from a static repository/category allowlist.',
      'No caller-supplied paths or commands were accepted.',
      'No code or repository files were modified.',
      'No patch was generated or proposed.',
      'No remote model or provider was invoked.'
    ];
    inspection.status = 'completed';
  } catch (error) {
    inspection.status = 'failed';
    inspection.limitations = [
      'The allowlisted reader failed before producing a complete evidence packet.',
      'No code or repository files were modified.',
      'No patch was generated or proposed.'
    ];
    inspection.recommendation = {
      action: 'inspect-reader-failure',
      summary: error instanceof Error ? error.message : String(error),
      patchProposed: false
    };
  }
  inspection.finishedAt = now();
}

function validateDiagnostic(diagnosticId: string): Diagnostic {
  const diagnostic = getDiagnosticResult(diagnosticId);
  if (diagnostic.status !== 'completed') {
    throw new Error(`Diagnostic '${diagnosticId}' is not completed (status: ${diagnostic.status}).`);
  }
  if (!diagnostic.diagnosis) {
    throw new Error(`Diagnostic '${diagnosticId}' has no completed diagnosis.`);
  }

  const task = getTaskStatus(diagnostic.sourceTaskId);
  if (task.status !== 'failed') {
    throw new Error(`Diagnostic '${diagnosticId}' does not reference a failed source task.`);
  }
  if (!getRepo(diagnostic.repo)) {
    throw new Error(`Repository '${diagnostic.repo}' is not registered.`);
  }
  return diagnostic;
}

export function createInspection(input: SpecialistInspectInput): Inspection {
  const diagnostic = validateDiagnostic(input.diagnosticId);
  const plan = getPlan(diagnostic);
  const inspection: Inspection = {
    id: randomUUID(),
    diagnosticId: diagnostic.id,
    sourceTaskId: diagnostic.sourceTaskId,
    repo: diagnostic.repo,
    status: 'queued',
    createdAt: now(),
    finishedAt: null,
    filesRequested: [...plan.files],
    filesRead: [],
    evidence: null,
    recommendation: null,
    limitations: ['Inspection is queued and has not read repository files.']
  };

  inspections.set(inspection.id, inspection);
  const timer = setTimeout(() => {
    void completeInspection(inspection.id, diagnostic, plan);
  }, 0);
  timer.unref?.();
  return snapshot(inspection);
}

export function getInspectionStatus(inspectionId: string): Inspection {
  const inspection = inspections.get(inspectionId);
  if (!inspection) throw new Error(`Unknown inspection id '${inspectionId}'.`);
  return snapshot(inspection);
}

export function getInspectionResult(inspectionId: string): Inspection {
  const inspection = inspections.get(inspectionId);
  if (!inspection) throw new Error(`Unknown inspection id '${inspectionId}'.`);
  if (inspection.status === 'queued' || inspection.status === 'running') {
    throw new Error(`Inspection '${inspectionId}' is not complete (status: ${inspection.status}).`);
  }
  return snapshot(inspection);
}

export function specialistLimits(): {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
} {
  return {
    maxFiles: MAX_FILES_PER_INSPECTION,
    maxFileBytes: MAX_FILE_BYTES,
    maxTotalBytes: MAX_TOTAL_BYTES
  };
}