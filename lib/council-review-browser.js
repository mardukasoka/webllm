import {
  reasonOverReviewPacket,
} from "./council-review-reasoner.js";

function compactReport({
  reviewPacket,
  evidenceDigest,
  participant,
  reasoning,
  recordResult,
}) {
  const proposal = reasoning?.proposal || null;
  return {
    reviewId: reviewPacket?.reviewId || null,
    evidenceDigest: evidenceDigest || null,
    runtime: participant?.runtime || null,
    model: participant?.model || null,
    attempts: reasoning?.attempts || 0,
    proposalSummary: proposal?.summary || null,
    confidence: proposal?.confidence || null,
    proposedPaths: proposal?.changes?.map(change => change.path) || [],
    testsRecommended: proposal?.testsRecommended || [],
    applyRequested: proposal?.applyRequested ?? null,
    recordProposalStatus: recordResult?.status || null,
  };
}

export async function runLocalLfmCouncilReview({
  reviewPacket,
  evidenceDigest,
  participant,
  recordProposal,
  log,
} = {}) {
  if (!participant
    || participant.runtime !== "lfm2"
    || typeof participant.generate !== "function") {
    const reasoning = {
      ok: false,
      status: "unavailable",
      error: "A loaded local LFM2.5 Council participant is required.",
      attempts: 0,
    };
    const result = {
      ...reasoning,
      report: compactReport({
        reviewPacket,
        evidenceDigest,
        participant,
        reasoning,
      }),
    };
    log?.(result.report);
    return result;
  }
  if (typeof recordProposal !== "function") {
    const reasoning = {
      ok: false,
      status: "record-unavailable",
      error: "The council.record_proposal boundary is required.",
      attempts: 0,
    };
    const result = {
      ...reasoning,
      report: compactReport({
        reviewPacket,
        evidenceDigest,
        participant,
        reasoning,
      }),
    };
    log?.(result.report);
    return result;
  }

  const reasoning = await reasonOverReviewPacket({
    reviewPacket,
    participant,
  });
  if (!reasoning.ok) {
    const report = compactReport({
      reviewPacket,
      evidenceDigest,
      participant,
      reasoning,
    });
    log?.(report);
    return { ...reasoning, report };
  }

  let recordResult;
  try {
    recordResult = await recordProposal({
      reviewId: reviewPacket.reviewId,
      proposal: reasoning.proposal,
    });
  } catch (error) {
    const failed = {
      ok: false,
      status: "record-failed",
      error: error instanceof Error ? error.message : String(error),
      attempts: reasoning.attempts,
      proposal: reasoning.proposal,
    };
    const report = compactReport({
      reviewPacket,
      evidenceDigest,
      participant,
      reasoning: failed,
    });
    log?.(report);
    return { ...failed, report };
  }

  const accepted = recordResult?.status === "proposed"
    && recordResult?.id === reviewPacket.reviewId;
  const result = {
    ok: accepted,
    status: accepted ? "proposed" : "record-rejected",
    attempts: reasoning.attempts,
    proposal: reasoning.proposal,
    recordResult,
  };
  const report = compactReport({
    reviewPacket,
    evidenceDigest,
    participant,
    reasoning: result,
    recordResult,
  });
  log?.(report);
  return { ...result, report };
}