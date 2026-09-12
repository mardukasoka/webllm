import { describe, expect, it } from "vitest";
import {
  compareFederatedCouncilCandidates,
  federatedCandidatesToProposalEnvelopes,
} from "../lib/council-federation-review.js";

const reviewPacket = {
  reviewId: "review-1",
  evidenceDigest: "digest-1",
  allowedFiles: ["lib/models.js", "tests/models.test.js"],
};

function proposal(summary, path, confidence = "medium") {
  return JSON.stringify({
    summary,
    rationale: `${summary} rationale`,
    confidence,
    changes: [{ path, reason: `${summary} reason`, unifiedDiff: "@@ -1 +1 @@\n-old\n+new" }],
    testsRecommended: ["npm test"],
    applyRequested: false,
  });
}

describe("federated Council review envelopes", () => {
  it("converts valid provider candidates into provenance-linked proposal envelopes", () => {
    const [result] = federatedCandidatesToProposalEnvelopes({
      reviewPacket,
      candidates: [{ model: "provider/model-a", ok: true, content: proposal("A", "lib/models.js") }],
    });

    expect(result.ok).toBe(true);
    expect(result.envelope.reviewId).toBe("review-1");
    expect(result.envelope.evidenceDigest).toBe("digest-1");
    expect(result.envelope.sourceId).toBe("federated:provider/model-a");
    expect(result.envelope.runtime).toBe("federated-remote");
  });

  it("preserves provider and validation failures instead of silently dropping them", () => {
    const results = federatedCandidatesToProposalEnvelopes({
      reviewPacket,
      candidates: [
        { model: "provider/down", ok: false, error: "HTTP 503" },
        { model: "provider/bad", ok: true, content: "not json" },
      ],
    });

    expect(results[0]).toMatchObject({ ok: false, status: "provider-failed" });
    expect(results[1]).toMatchObject({ ok: false, status: "invalid-proposal" });
  });

  it("compares two valid proposals without producing a winner or merged patch", () => {
    const result = compareFederatedCouncilCandidates({
      reviewPacket,
      candidates: [
        { model: "provider/model-a", ok: true, content: proposal("A", "lib/models.js", "high") },
        { model: "provider/model-b", ok: true, content: proposal("B", "tests/models.test.js", "medium") },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("compared");
    expect(result.participantCount).toBe(2);
    expect(result.winner).toBeUndefined();
    expect(result.rankings).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("@@ -1 +1 @@");
  });

  it("refuses comparison when fewer than two candidates validate", () => {
    const result = compareFederatedCouncilCandidates({
      reviewPacket,
      candidates: [
        { model: "provider/model-a", ok: true, content: proposal("A", "lib/models.js") },
        { model: "provider/bad", ok: true, content: "{}" },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      status: "insufficient-valid-proposals",
      validProposalCount: 1,
    });
  });
});
