import {
  generateCouncilParticipant,
} from "./council-provider.js";

export const COUNCIL_REVIEW_REASONING_INSTRUCTION = [
  "You are a read-only software diagnostic specialist.",
  "Analyze only the supplied review packet.",
  "Return only JSON matching the requested proposal schema.",
  "Do not claim any file was modified.",
  "Do not reference files outside allowedFiles.",
  "Do not invent unavailable repository context.",
  "If the evidence is insufficient, return changes: [].",
  "applyRequested must always be false.",
].join("\n");

const LOCAL_RUNTIMES = new Set(["gemma", "bonsai", "lfm2"]);
const MAX_FILES = 4;
const MAX_FILE_BYTES = 20_000;
const MAX_TOTAL_BYTES = 60_000;
const MAX_DIFF_BYTES = 12_000;
const MAX_PROPOSAL_BYTES = 40_000;
const PROPOSAL_KEYS = [
  "summary",
  "rationale",
  "confidence",
  "changes",
  "testsRecommended",
  "applyRequested",
];
const CHANGE_KEYS = ["path", "reason", "unifiedDiff"];
const ALLOWED_CONFIDENCE = new Set(["low", "medium", "high"]);
const ALLOWED_TESTS = new Set(["npm test", "npm run lint"]);

function failure(status, error, attempts = 0) {
  return {
    ok: false,
    status,
    error,
    attempts,
  };
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === [...keys].sort()[index]);
}

function validateReviewPacket(reviewPacket) {
  const requiredKeys = [
    "reviewId",
    "repo",
    "sourceTaskId",
    "diagnosticCategory",
    "diagnosticSummary",
    "stdoutSummary",
    "stderrSummary",
    "files",
    "allowedFiles",
    "taskContext",
    "instructions",
    "outputSchema",
  ];
  if (!isRecord(reviewPacket) || !hasExactKeys(reviewPacket, requiredKeys)) {
    return "The reasoner accepts only a Council review packet produced by council.prepare_review.";
  }
  for (const key of [
    "reviewId",
    "repo",
    "sourceTaskId",
    "diagnosticCategory",
    "diagnosticSummary",
    "stdoutSummary",
    "stderrSummary",
  ]) {
    if (typeof reviewPacket[key] !== "string") {
      return `Review packet field '${key}' must be a string.`;
    }
  }
  if (!Array.isArray(reviewPacket.allowedFiles)
    || reviewPacket.allowedFiles.length > MAX_FILES
    || new Set(reviewPacket.allowedFiles).size !== reviewPacket.allowedFiles.length
    || reviewPacket.allowedFiles.some(file => typeof file !== "string")) {
    return "Review packet allowedFiles must be an array of relative file paths.";
  }
  if (!Array.isArray(reviewPacket.files)
    || reviewPacket.files.length > MAX_FILES
    || reviewPacket.files.length !== reviewPacket.allowedFiles.length) {
    return `Review packet files must contain exactly the bounded allowlisted files (at most ${MAX_FILES}).`;
  }

  const allowedFiles = new Set(reviewPacket.allowedFiles);
  const seenFiles = new Set();
  let totalBytes = 0;
  for (const file of reviewPacket.files) {
    if (!isRecord(file) || !hasExactKeys(file, ["path", "bytesRead", "truncated", "content"])) {
      return "Review packet contains an invalid bounded file entry.";
    }
    if (!allowedFiles.has(file.path) || seenFiles.has(file.path)) {
      return `Review packet contains a file outside allowedFiles: '${file.path}'.`;
    }
    if (!Number.isInteger(file.bytesRead)
      || file.bytesRead < 0
      || file.bytesRead > MAX_FILE_BYTES
      || typeof file.truncated !== "boolean"
      || typeof file.content !== "string"
      || new TextEncoder().encode(file.content).length > MAX_FILE_BYTES) {
      return `Review packet file '${file.path}' exceeds its bounded evidence contract.`;
    }
    seenFiles.add(file.path);
    totalBytes += file.bytesRead;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return "Review packet exceeds its total evidence byte limit.";
  }
  if (!isRecord(reviewPacket.taskContext)
    || !isRecord(reviewPacket.outputSchema)
    || !Array.isArray(reviewPacket.instructions)) {
    return "Review packet is missing its fixed task context or output schema.";
  }
  return null;
}

function unwrapJson(rawText) {
  const text = String(rawText || "").trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced ? fenced[1] : text).trim();
}

export function parseCouncilProposal(rawText, allowedFiles = []) {
  const jsonText = unwrapJson(rawText);
  if (!jsonText) {
    return { ok: false, error: "The local Council returned no proposal JSON." };
  }

  let proposal;
  try {
    proposal = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: "The local Council response was not valid JSON." };
  }

  if (!isRecord(proposal) || !hasExactKeys(proposal, PROPOSAL_KEYS)) {
    return { ok: false, error: "The local Council JSON did not match the proposal schema." };
  }
  if (typeof proposal.summary !== "string"
    || typeof proposal.rationale !== "string"
    || !ALLOWED_CONFIDENCE.has(proposal.confidence)
    || !Array.isArray(proposal.changes)
    || !Array.isArray(proposal.testsRecommended)
    || proposal.applyRequested !== false) {
    return { ok: false, error: "The local Council JSON failed proposal field validation." };
  }
  if (proposal.changes.length > MAX_FILES
    || proposal.testsRecommended.some(test => !ALLOWED_TESTS.has(test))
    || new Set(proposal.testsRecommended).size !== proposal.testsRecommended.length) {
    return { ok: false, error: "The local Council JSON exceeded the proposal limits or test allowlist." };
  }

  const allowed = new Set(allowedFiles);
  const seen = new Set();
  for (const change of proposal.changes) {
    if (!isRecord(change) || !hasExactKeys(change, CHANGE_KEYS)
      || typeof change.path !== "string"
      || typeof change.reason !== "string"
      || typeof change.unifiedDiff !== "string") {
      return { ok: false, error: "The local Council JSON contains an invalid change entry." };
    }
    if (!allowed.has(change.path) || seen.has(change.path)) {
      return { ok: false, error: `The local Council proposal references an uninspected or duplicate file: '${change.path}'.` };
    }
    if (new TextEncoder().encode(change.unifiedDiff).length > MAX_DIFF_BYTES) {
      return { ok: false, error: `The local Council diff for '${change.path}' exceeds the bounded diff limit.` };
    }
    seen.add(change.path);
  }
  if (new TextEncoder().encode(JSON.stringify(proposal)).length > MAX_PROPOSAL_BYTES) {
    return { ok: false, error: "The local Council proposal exceeds the bounded proposal limit." };
  }
  return { ok: true, proposal };
}

export async function reasonOverReviewPacket({
  reviewPacket,
  participant,
  signal,
} = {}) {
  const packetError = validateReviewPacket(reviewPacket);
  if (packetError) return failure("invalid-input", packetError);

  if (!participant
    || !LOCAL_RUNTIMES.has(participant.runtime)
    || typeof participant.generate !== "function") {
    return failure(
      "unavailable",
      "The configured local Council model is unavailable; no remote fallback was attempted.",
    );
  }

  const safeParticipant = {
    id: participant.id || participant.model || participant.runtime,
    name: participant.name || participant.id || participant.runtime,
    model: participant.model || null,
    runtime: participant.runtime,
    generate: participant.generate,
    systemPrompt: COUNCIL_REVIEW_REASONING_INSTRUCTION,
    tools: [],
    maxNewTokens: 1024,
  };

  let response;
  try {
    response = await generateCouncilParticipant({
      participant: safeParticipant,
      transcript: [{
        role: "user",
        speaker: "user",
        content: JSON.stringify(reviewPacket),
      }],
      round: 1,
      signal,
    });
  } catch (error) {
    return failure(
      "inference-failed",
      error instanceof Error ? error.message : String(error),
      1,
    );
  }

  const raw = typeof response === "string"
    ? response
    : response?.content || response?.raw || "";
  const parsed = parseCouncilProposal(raw, reviewPacket.allowedFiles);
  if (!parsed.ok) return failure("invalid-output", parsed.error, 1);
  return {
    ok: true,
    status: "proposal-ready",
    attempts: 1,
    proposal: parsed.proposal,
  };
}