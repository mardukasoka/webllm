import {
  COUNCIL_REVIEW_REASONING_INSTRUCTION,
  parseCouncilProposal,
} from "./council-review-reasoner.js";
import {
  generateCouncilParticipant,
} from "./council-provider.js";

function failure(status, error, attempts = 0) {
  return {
    ok: false,
    status,
    error,
    attempts,
  };
}

function validPacketShape(reviewPacket) {
  if (!reviewPacket || typeof reviewPacket !== "object" || Array.isArray(reviewPacket)) {
    return false;
  }
  if (!Array.isArray(reviewPacket.allowedFiles)
    || !Array.isArray(reviewPacket.files)
    || reviewPacket.allowedFiles.length !== reviewPacket.files.length) {
    return false;
  }
  const allowed = new Set(reviewPacket.allowedFiles);
  return reviewPacket.files.every(file =>
    file
    && typeof file === "object"
    && typeof file.path === "string"
    && allowed.has(file.path)
  );
}

export async function reasonOverReviewPacketWithGemini({
  reviewPacket,
  participant,
  signal,
} = {}) {
  if (!validPacketShape(reviewPacket)) {
    return failure(
      "invalid-input",
      "Gemini review reasoning accepts only a bounded council.prepare_review packet."
    );
  }

  if (!participant
    || participant.runtime !== "gemini"
    || !participant.modelInstance?.apiKey
    || !participant.modelInstance?.model) {
    return failure(
      "unavailable",
      "Gemini review reasoning is not configured; no provider fallback was attempted."
    );
  }

  const safeParticipant = {
    id: participant.id || participant.modelInstance.model,
    name: participant.name || "Gemini Review Specialist",
    model: participant.modelInstance.model,
    runtime: "gemini",
    modelInstance: participant.modelInstance,
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
        content: JSON.stringify(reviewPacket),
      }],
      round: 1,
      signal,
    });
  } catch (error) {
    return failure(
      "inference-failed",
      error instanceof Error ? error.message : String(error),
      1
    );
  }

  const raw = response?.content || "";
  const parsed = parseCouncilProposal(raw, reviewPacket.allowedFiles);
  if (!parsed.ok) {
    return failure("invalid-output", parsed.error, 1);
  }

  return {
    ok: true,
    status: "proposal-ready",
    attempts: 1,
    proposal: parsed.proposal,
    metadata: response?.metadata || null,
  };
}
