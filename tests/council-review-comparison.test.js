import { describe, expect, it } from "vitest";
import { compareCouncilProposals } from "../lib/council-review-comparison.js";

function proposal({
  path = "lib/models.js",
  confidence = "medium",
  tests = ["npm test"],
  reason = "Align the inspected expectation with the implementation.",
} = {}) {
  return {
    summary: `Review ${path}`,
    rationale: "Bounded inspected evidence supports reviewing this path.",
    confidence,
    changes: [{
      path,
      reason,
      unifiedDiff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new`,
    }],
    testsRecommended: tests,
    applyRequested: false,
  };
}

function envelope(sourceId, candidate, extra = {}) {
  return {
    reviewId: "review-1",
    evidenceDigest: "digest-1",
    sourceId,
    runtime: extra.runtime || null,
    model: extra.model || null,
    proposal: candidate,
  };
}

describe("Council proposal comparison", () => {
  it("preserves agreements and disagreements without selecting a winner", () => {
    const result = compareCouncilProposals({
      proposals: [
        envelope("local-lfm", proposal(), { runtime: "lfm2", model: "lfm2" }),
        envelope("gemini", proposal({
          path: "lib/sessions.js",
          confidence: "high",
          tests: ["npm test", "npm run lint"],
        }), { runtime: "gemini", model: "gemini-3.8-flash" }),
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      status: "compared",
      reviewId: "review-1",
      evidenceDigest: "digest-1",
      participantCount: 2,
      agreements: {
        sharedPaths: [],
        sharedTests: ["npm test"],
        allApplyRequestedFalse: true,
      },
      disagreements: {
        paths: ["lib/models.js", "lib/sessions.js"],
        tests: ["npm run lint"],
        confidence: ["high", "medium"],
      },
    });
    expect(result).not.toHaveProperty("winner");
    expect(result).not.toHaveProperty("ranking");
    expect(result).not.toHaveProperty("selectedProposal");
    expect(JSON.stringify(result)).not.toContain("unifiedDiff");
    expect(JSON.stringify(result)).not.toContain("@@ -1 +1 @@");
  });

  it("requires the same evidence boundary and unique sources", () => {
    const first = envelope("local-lfm", proposal());
    const wrongDigest = {
      ...envelope("gemini", proposal()),
      evidenceDigest: "digest-2",
    };
    expect(compareCouncilProposals({ proposals: [first, wrongDigest] }))
      .toMatchObject({ ok: false, status: "invalid-comparison-input" });

    expect(compareCouncilProposals({ proposals: [first, envelope("local-lfm", proposal())] }))
      .toMatchObject({ ok: false, status: "invalid-comparison-input" });
  });

  it("rejects apply authority and non-allowlisted tests", () => {
    const applyProposal = { ...proposal(), applyRequested: true };
    expect(compareCouncilProposals({
      proposals: [
        envelope("local-lfm", proposal()),
        envelope("gemini", applyProposal),
      ],
    })).toMatchObject({ ok: false, status: "invalid-comparison-input" });

    expect(compareCouncilProposals({
      proposals: [
        envelope("local-lfm", proposal()),
        envelope("gemini", proposal({ tests: ["npm run deploy"] })),
      ],
    })).toMatchObject({ ok: false, status: "invalid-comparison-input" });
  });
});
