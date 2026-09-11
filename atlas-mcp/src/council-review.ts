import { createHash, randomUUID } from 'node:crypto';
import * as z from 'zod/v4';
import { getRepo } from './registry.js';
import {
  getDiagnosticResult,
  type Diagnostic,
  type DiagnosisCategory
} from './debugger.js';
import {
  getInspectionResult,
  type Inspection,
  type InspectionFile
} from './specialist.js';

export const councilPrepareReviewInputSchema = z.object({
  inspectionId: z.string().min(1)
}).strict();

const proposalChangeSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
  unifiedDiff: z.string()
}).strict();

export const councilProposalSchema = z.object({
  summary: z.string().min(1),
  rationale: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
  changes: z.array(proposalChangeSchema).max(4),
  testsRecommended: z.array(z.enum(['npm test', 'npm run lint'])).max(2),
  applyRequested: z.literal(false)
}).strict();

export const councilRecordProposalInputSchema = z.object({
  reviewId: z.string().min(1),
  proposal: councilProposalSchema
}).strict();

export type CouncilPrepareReviewInput = z.infer<typeof councilPrepareReviewInputSchema>;
export type CouncilProposal = z.infer<typeof councilProposalSchema>;
export type CouncilRecordProposalInput = z.infer<typeof councilRecordProposalInputSchema>;
export type CouncilReviewStatus = 'prepared' | 'proposed' | 'rejected';

export const MAX_PROPOSAL_FILES = 4;
export const MAX_DIFF_BYTES_PER_FILE = 12_000;
export const MAX_PROPOSAL_BYTES = 40_000;

type ReviewPacketFile = Pick<InspectionFile, 'path' | 'bytesRead' | 'truncated' | 'content'>;

export type ReviewPacket = {
  reviewId: string;
  repo: string;
  sourceTaskId: string;
  diagnosticCategory: DiagnosisCategory;
  diagnosticSummary: string;
  stdoutSummary: string;
  stderrSummary: string;
  files: ReviewPacketFile[];
  allowedFiles: string[];
  taskContext: {
    taskType: Diagnostic['evidence']['taskType'];
    action: string | null;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
  };
  instructions: string[];
  outputSchema: {
    summary: 'string';
    rationale: 'string';
    confidence: ['low', 'medium', 'high'];
    changes: 'array of bounded unified diffs';
    testsRecommended: ['npm test', 'npm run lint'];
    applyRequested: false;
  };
};

type Validation = {
  valid: boolean;
  errors: string[];
  checkedAt: string;
};

export type CouncilReview = {
  id: string;
  inspectionId: string;
  diagnosticId: string;
  sourceTaskId: string;
  repo: string;
  status: CouncilReviewStatus;
  createdAt: string;
  proposalRecordedAt: string | null;
  allowedFiles: string[];
  evidenceDigest: string;
  reviewPacket: ReviewPacket;
  proposal: CouncilProposal | null;
  validation: Validation;
  limitations: string[];
};

const reviews = new Map<string, CouncilReview>();

function now(): string {
  return new Date().toISOString();
}

function clonePacket(packet: ReviewPacket): ReviewPacket {
  return {
    ...packet,
    files: packet.files.map((file) => ({ ...file })),
    allowedFiles: [...packet.allowedFiles],
    taskContext: { ...packet.taskContext },
    instructions: [...packet.instructions],
    outputSchema: {
      ...packet.outputSchema,
      confidence: [...packet.outputSchema.confidence] as ['low', 'medium', 'high'],
      testsRecommended: [...packet.outputSchema.testsRecommended] as ['npm test', 'npm run lint']
    }
  };
}

function snapshot(review: CouncilReview): CouncilReview {
  return {
    ...review,
    allowedFiles: [...review.allowedFiles],
    reviewPacket: clonePacket(review.reviewPacket),
    proposal: review.proposal
      ? {
          ...review.proposal,
          changes: review.proposal.changes.map((change) => ({ ...change })),
          testsRecommended: [...review.proposal.testsRecommended]
        }
      : null,
    validation: {
      ...review.validation,
      errors: [...review.validation.errors]
    },
    limitations: [...review.limitations]
  };
}

function validateEvidence(inspection: Inspection, diagnostic: Diagnostic): void {
  if (inspection.status !== 'completed' || !inspection.evidence) {
    throw new Error(`Inspection '${inspection.id}' does not contain completed specialist evidence.`);
  }
  if (inspection.repo !== diagnostic.repo || inspection.sourceTaskId !== diagnostic.sourceTaskId) {
    throw new Error(`Inspection '${inspection.id}' does not match its diagnostic provenance.`);
  }
  if (!getRepo(inspection.repo)) {
    throw new Error(`Repository '${inspection.repo}' is not registered.`);
  }

  const files = inspection.evidence.files;
  if (files.length > 6 || files.length !== inspection.filesRead.length) {
    throw new Error(`Inspection '${inspection.id}' has an invalid specialist file count.`);
  }

  const allowedFiles = new Set(inspection.filesRequested);
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    if (!allowedFiles.has(file.path) || seen.has(file.path)) {
      throw new Error(`Inspection '${inspection.id}' contains a file outside its static evidence selection.`);
    }
    if (file.bytesRead < 0 || file.bytesRead > 20_000 || typeof file.content !== 'string') {
      throw new Error(`Inspection '${inspection.id}' contains unbounded file evidence.`);
    }
    if (Buffer.byteLength(file.content, 'utf8') > 20_000) {
      throw new Error(`Inspection '${inspection.id}' contains a file excerpt over the byte limit.`);
    }
    seen.add(file.path);
    totalBytes += file.bytesRead;
  }
  if (totalBytes > 60_000) {
    throw new Error(`Inspection '${inspection.id}' contains evidence over the total byte limit.`);
  }
}

function digestFor(
  inspection: Inspection,
  diagnostic: Diagnostic,
  allowedFiles: string[]
): string {
  const digestInput = {
    inspectionId: inspection.id,
    sourceTaskId: inspection.sourceTaskId,
    allowedFiles,
    files: inspection.evidence!.files.map((file) => ({
      path: file.path,
      content: file.content
    })),
    diagnosticCategory: diagnostic.diagnosis!.category,
    diagnosticSummary: diagnostic.diagnosis!.summary
  };
  return createHash('sha256')
    .update(JSON.stringify(digestInput), 'utf8')
    .digest('hex');
}

function buildPacket(
  reviewId: string,
  inspection: Inspection,
  diagnostic: Diagnostic,
  allowedFiles: string[]
): ReviewPacket {
  const evidence = inspection.evidence!;
  return {
    reviewId,
    repo: inspection.repo,
    sourceTaskId: inspection.sourceTaskId,
    diagnosticCategory: diagnostic.diagnosis!.category,
    diagnosticSummary: diagnostic.diagnosis!.summary,
    stdoutSummary: evidence.stdoutSummary,
    stderrSummary: evidence.stderrSummary,
    files: evidence.files.map((file) => ({ ...file })),
    allowedFiles: [...allowedFiles],
    taskContext: {
      taskType: diagnostic.evidence.taskType,
      action: diagnostic.evidence.action,
      exitCode: diagnostic.evidence.exitCode,
      signal: diagnostic.evidence.signal,
      timedOut: diagnostic.evidence.timedOut
    },
    instructions: [
      'Analyze only the supplied evidence.',
      'Return a proposed remediation, not a claim that a change was applied.',
      'Do not reference files outside allowedFiles.',
      'If the evidence is insufficient, return no patch.'
    ],
    outputSchema: {
      summary: 'string',
      rationale: 'string',
      confidence: ['low', 'medium', 'high'],
      changes: 'array of bounded unified diffs',
      testsRecommended: ['npm test', 'npm run lint'],
      applyRequested: false
    }
  };
}

function reject(review: CouncilReview, errors: string[]): never {
  review.status = 'rejected';
  review.validation = {
    valid: false,
    errors,
    checkedAt: now()
  };
  throw new Error(`Proposal rejected: ${errors.join(' ')}`);
}

function validateUnifiedDiff(path: string, unifiedDiff: string): string[] {
  if (!unifiedDiff) return [];

  const errors: string[] = [];
  const expectedOldHeader = `--- a/${path}`;
  const expectedNewHeader = `+++ b/${path}`;
  const lines = unifiedDiff.split('\n');
  if (lines[0] !== expectedOldHeader || lines[1] !== expectedNewHeader) {
    errors.push(`Change for '${path}' must begin with '${expectedOldHeader}' and '${expectedNewHeader}'.`);
  }

  for (const line of lines) {
    if (line.startsWith('--- ') && line !== expectedOldHeader) {
      errors.push(`Unified diff for '${path}' targets another old file.`);
    }
    if (line.startsWith('+++ ') && line !== expectedNewHeader) {
      errors.push(`Unified diff for '${path}' targets another new file.`);
    }
  }

  for (const marker of ['/dev/null', 'GIT binary patch', 'rename from', 'rename to', 'new file mode', 'deleted file mode']) {
    if (unifiedDiff.includes(marker)) {
      errors.push(`Unified diff for '${path}' contains forbidden marker '${marker}'.`);
    }
  }
  if (Buffer.byteLength(unifiedDiff, 'utf8') > MAX_DIFF_BYTES_PER_FILE) {
    errors.push(`Unified diff for '${path}' exceeds ${MAX_DIFF_BYTES_PER_FILE} bytes.`);
  }
  return errors;
}

function validateProposal(review: CouncilReview, proposal: CouncilProposal): string[] {
  const errors: string[] = [];
  if (proposal.changes.length > MAX_PROPOSAL_FILES) {
    errors.push(`A proposal may contain at most ${MAX_PROPOSAL_FILES} files.`);
  }

  const allowed = new Set(review.allowedFiles);
  const seen = new Set<string>();
  for (const change of proposal.changes) {
    if (!allowed.has(change.path)) {
      errors.push(`Proposed path '${change.path}' was not inspected.`);
    }
    if (pathIsUnsafe(change.path)) {
      errors.push(`Proposed path '${change.path}' is not a safe relative allowlisted path.`);
    }
    if (seen.has(change.path)) {
      errors.push(`Proposed path '${change.path}' appears more than once.`);
    }
    seen.add(change.path);
    errors.push(...validateUnifiedDiff(change.path, change.unifiedDiff));
  }

  const tests = proposal.testsRecommended;
  if (new Set(tests).size !== tests.length) {
    errors.push('testsRecommended may not contain duplicate actions.');
  }
  if (Buffer.byteLength(JSON.stringify(proposal), 'utf8') > MAX_PROPOSAL_BYTES) {
    errors.push(`The proposal exceeds ${MAX_PROPOSAL_BYTES} bytes.`);
  }
  return errors;
}

function pathIsUnsafe(value: string): boolean {
  return value.startsWith('/') || value.includes('..') || value.includes('\\') || value !== value.trim();
}

export function prepareReview(input: CouncilPrepareReviewInput): CouncilReview {
  const inspection = getInspectionResult(input.inspectionId);
  if (inspection.status !== 'completed') {
    throw new Error(`Inspection '${input.inspectionId}' is not completed.`);
  }
  const diagnostic = getDiagnosticResult(inspection.diagnosticId);
  if (diagnostic.status !== 'completed' || !diagnostic.diagnosis) {
    throw new Error(`Diagnostic '${inspection.diagnosticId}' is not completed.`);
  }
  validateEvidence(inspection, diagnostic);

  const reviewId = randomUUID();
  const allowedFiles = [...inspection.filesRequested];
  const review: CouncilReview = {
    id: reviewId,
    inspectionId: inspection.id,
    diagnosticId: diagnostic.id,
    sourceTaskId: inspection.sourceTaskId,
    repo: inspection.repo,
    status: 'prepared',
    createdAt: now(),
    proposalRecordedAt: null,
    allowedFiles,
    evidenceDigest: digestFor(inspection, diagnostic, allowedFiles),
    reviewPacket: buildPacket(reviewId, inspection, diagnostic, allowedFiles),
    proposal: null,
    validation: {
      valid: false,
      errors: ['No proposal has been recorded.'],
      checkedAt: now()
    },
    limitations: [
      'The review packet contains only bounded specialist evidence.',
      'No model or provider was invoked by MCP.',
      'No proposal has been applied.'
    ]
  };
  reviews.set(review.id, review);
  return snapshot(review);
}

export function getReviewStatus(reviewId: string): CouncilReview {
  const review = reviews.get(reviewId);
  if (!review) throw new Error(`Unknown review id '${reviewId}'.`);
  return snapshot(review);
}

export function recordProposal(input: CouncilRecordProposalInput): CouncilReview {
  const review = reviews.get(input.reviewId);
  if (!review) throw new Error(`Unknown review id '${input.reviewId}'.`);
  if (review.status !== 'prepared') {
    throw new Error(`Review '${input.reviewId}' is not prepared (status: ${review.status}).`);
  }

  const errors = validateProposal(review, input.proposal);
  if (errors.length > 0) reject(review, errors);

  review.proposal = {
    ...input.proposal,
    changes: input.proposal.changes.map((change) => ({ ...change })),
    testsRecommended: [...input.proposal.testsRecommended]
  };
  review.status = 'proposed';
  review.proposalRecordedAt = now();
  review.validation = {
    valid: true,
    errors: [],
    checkedAt: now()
  };
  review.limitations = [
    'The proposal was structurally validated only.',
    'No diff was applied or tested.',
    'No files were written and no Git operation was performed.',
    'No model or provider was invoked by MCP.'
  ];
  return snapshot(review);
}