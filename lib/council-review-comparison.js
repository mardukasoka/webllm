const ALLOWED_CONFIDENCE = new Set(["low", "medium", "high"]);
const ALLOWED_TESTS = new Set(["npm test", "npm run lint"]);
const MAX_PROPOSALS = 4;

function fail(error) {
  return { ok: false, status: "invalid-comparison-input", error };
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function intersection(groups) {
  if (!groups.length) return [];
  const [first, ...rest] = groups.map(group => new Set(group));
  return [...first].filter(value => rest.every(group => group.has(value))).sort();
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return "Each comparison entry must be a proposal envelope.";
  }
  for (const key of ["reviewId", "evidenceDigest", "sourceId"]) {
    if (typeof envelope[key] !== "string" || !envelope[key].trim()) {
      return `Comparison envelope field '${key}' must be a non-empty string.`;
    }
  }
  const proposal = envelope.proposal;
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
    return "Each comparison envelope must contain a validated proposal.";
  }
  if (typeof proposal.summary !== "string"
    || typeof proposal.rationale !== "string"
    || !ALLOWED_CONFIDENCE.has(proposal.confidence)
    || !Array.isArray(proposal.changes)
    || !Array.isArray(proposal.testsRecommended)
    || proposal.applyRequested !== false) {
    return `Proposal from '${envelope.sourceId}' is outside the bounded proposal contract.`;
  }
  if (proposal.testsRecommended.some(test => !ALLOWED_TESTS.has(test))) {
    return `Proposal from '${envelope.sourceId}' recommends a non-allowlisted test.`;
  }
  for (const change of proposal.changes) {
    if (!change
      || typeof change !== "object"
      || typeof change.path !== "string"
      || typeof change.reason !== "string"
      || typeof change.unifiedDiff !== "string") {
      return `Proposal from '${envelope.sourceId}' contains an invalid change entry.`;
    }
  }
  return null;
}

export function compareCouncilProposals({ proposals } = {}) {
  if (!Array.isArray(proposals) || proposals.length < 2 || proposals.length > MAX_PROPOSALS) {
    return fail(`Comparison requires between 2 and ${MAX_PROPOSALS} validated proposals.`);
  }

  for (const envelope of proposals) {
    const error = validateEnvelope(envelope);
    if (error) return fail(error);
  }

  const reviewIds = uniqueSorted(proposals.map(item => item.reviewId));
  const digests = uniqueSorted(proposals.map(item => item.evidenceDigest));
  const sourceIds = proposals.map(item => item.sourceId);
  if (reviewIds.length !== 1 || digests.length !== 1) {
    return fail("All compared proposals must refer to the same reviewId and evidenceDigest.");
  }
  if (new Set(sourceIds).size !== sourceIds.length) {
    return fail("Each compared proposal must have a unique sourceId.");
  }

  const pathGroups = proposals.map(item => item.proposal.changes.map(change => change.path));
  const testGroups = proposals.map(item => item.proposal.testsRecommended);
  const allPaths = uniqueSorted(pathGroups.flat());
  const allTests = uniqueSorted(testGroups.flat());
  const sharedPaths = intersection(pathGroups);
  const sharedTests = intersection(testGroups);

  const bySource = proposals.map(item => ({
    sourceId: item.sourceId,
    runtime: item.runtime || null,
    model: item.model || null,
    summary: item.proposal.summary,
    rationale: item.proposal.rationale,
    confidence: item.proposal.confidence,
    proposedChanges: item.proposal.changes.map(change => ({
      path: change.path,
      reason: change.reason,
    })),
    testsRecommended: [...item.proposal.testsRecommended],
    applyRequested: false,
  }));

  return {
    ok: true,
    status: "compared",
    reviewId: reviewIds[0],
    evidenceDigest: digests[0],
    participantCount: proposals.length,
    sources: bySource,
    agreements: {
      sharedPaths,
      sharedTests,
      allApplyRequestedFalse: true,
    },
    disagreements: {
      paths: allPaths.filter(path => !sharedPaths.includes(path)),
      tests: allTests.filter(test => !sharedTests.includes(test)),
      confidence: uniqueSorted(proposals.map(item => item.proposal.confidence)),
    },
    limitations: [
      "This artifact compares proposals; it does not rank, vote, select, merge, or apply them.",
      "Unified diffs are deliberately omitted from the comparison artifact.",
      "A human or separately authorized policy boundary must resolve disagreements.",
    ],
  };
}
