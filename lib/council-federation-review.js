import { parseCouncilProposal } from "./council-review-reasoner.js";
import { compareCouncilProposals } from "./council-review-comparison.js";

function requireReviewPacket(reviewPacket) {
  if (!reviewPacket || typeof reviewPacket !== "object" || Array.isArray(reviewPacket)) {
    throw new Error("reviewPacket is required.");
  }
  for (const key of ["reviewId", "evidenceDigest"]) {
    if (typeof reviewPacket[key] !== "string" || !reviewPacket[key].trim()) {
      throw new Error(`reviewPacket.${key} is required.`);
    }
  }
  if (!Array.isArray(reviewPacket.allowedFiles)) {
    throw new Error("reviewPacket.allowedFiles must be an array.");
  }
}

export function federatedCandidatesToProposalEnvelopes({ reviewPacket, candidates } = {}) {
  requireReviewPacket(reviewPacket);
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 8) {
    throw new Error("candidates must contain between 1 and 8 provider results.");
  }

  return candidates.map((candidate) => {
    const model = typeof candidate?.model === "string" ? candidate.model : "unknown";
    if (!candidate?.ok || typeof candidate.content !== "string") {
      return {
        ok: false,
        model,
        status: "provider-failed",
        error: candidate?.error || "Provider candidate did not return bounded text."
      };
    }

    const parsed = parseCouncilProposal(candidate.content, reviewPacket.allowedFiles);
    if (!parsed.ok) {
      return {
        ok: false,
        model,
        status: "invalid-proposal",
        error: parsed.error
      };
    }

    return {
      ok: true,
      status: "proposal-envelope-ready",
      envelope: {
        reviewId: reviewPacket.reviewId,
        evidenceDigest: reviewPacket.evidenceDigest,
        sourceId: `federated:${model}`,
        runtime: "federated-remote",
        model,
        proposal: parsed.proposal
      }
    };
  });
}

export function compareFederatedCouncilCandidates({ reviewPacket, candidates } = {}) {
  const prepared = federatedCandidatesToProposalEnvelopes({ reviewPacket, candidates });
  const proposals = prepared.filter((item) => item.ok).map((item) => item.envelope);
  if (proposals.length < 2) {
    return {
      ok: false,
      status: "insufficient-valid-proposals",
      validProposalCount: proposals.length,
      candidates: prepared,
      error: "At least two validated proposals are required for comparison."
    };
  }

  return {
    ...compareCouncilProposals({ proposals }),
    candidates: prepared
  };
}
