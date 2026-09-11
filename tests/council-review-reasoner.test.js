import { describe, expect, it, vi } from "vitest";
import {
  COUNCIL_REVIEW_REASONING_INSTRUCTION,
  parseCouncilProposal,
  reasonOverReviewPacket,
} from "../lib/council-review-reasoner.js";

const allowedFiles = [
  "tests/models.test.js",
  "tests/sessions.test.js",
  "lib/models.js",
  "lib/sessions.js",
];

function reviewPacket() {
  return {
    reviewId: "review-1",
    repo: "webllm",
    sourceTaskId: "task-1",
    diagnosticCategory: "test-failure",
    diagnosticSummary: "The bounded output contains recognizable test failure markers.",
    stdoutSummary: "FAIL tests/models.test.js",
    stderrSummary: "",
    files: allowedFiles.map(path => ({
      path,
      bytesRead: 12,
      truncated: false,
      content: `evidence for ${path}`,
    })),
    allowedFiles: [...allowedFiles],
    taskContext: {
      taskType: "test",
      action: "npm test",
      exitCode: 1,
      signal: null,
      timedOut: false,
    },
    instructions: ["Analyze only the supplied evidence."],
    outputSchema: {
      summary: "string",
      rationale: "string",
      confidence: ["low", "medium", "high"],
      changes: "array of bounded unified diffs",
      testsRecommended: ["npm test", "npm run lint"],
      applyRequested: false,
    },
  };
}

function validProposal(path = allowedFiles[0]) {
  return {
    summary: "The supplied evidence suggests a test expectation mismatch.",
    rationale: "The proposal is limited to an inspected file.",
    confidence: "medium",
    changes: [{
      path,
      reason: "Review the failing expectation against the implementation.",
      unifiedDiff: `--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n-old\n+new`,
    }],
    testsRecommended: ["npm test"],
    applyRequested: false,
  };
}

function localParticipant(response) {
  return {
    id: "lfm2",
    name: "LFM2.5 230M",
    model: "lfm2",
    runtime: "lfm2",
    generate: vi.fn(async () => response),
  };
}

describe("council review reasoner", () => {
  it("uses the existing Council provider with fixed instructions and no tools", async () => {
    const participant = localParticipant(
      `\`\`\`json\n${JSON.stringify(validProposal())}\n\`\`\``,
    );

    const result = await reasonOverReviewPacket({
      reviewPacket: reviewPacket(),
      participant,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "proposal-ready",
      attempts: 1,
      proposal: validProposal(),
    });
    expect(participant.generate).toHaveBeenCalledTimes(1);
    const call = participant.generate.mock.calls[0][0];
    expect(call.tools).toEqual([]);
    expect(call.messages).toHaveLength(2);
    expect(call.messages[0]).toEqual({
      role: "system",
      content: COUNCIL_REVIEW_REASONING_INSTRUCTION,
    });
    expect(call.messages[1].role).toBe("user");
    expect(call.messages[1].content).toContain('"reviewId":"review-1"');
  });

  it("parses only raw or fully fenced JSON", () => {
    const proposal = validProposal();
    expect(parseCouncilProposal(JSON.stringify(proposal), allowedFiles)).toEqual({
      ok: true,
      proposal,
    });
    expect(parseCouncilProposal(`before ${JSON.stringify(proposal)}`, allowedFiles).ok)
      .toBe(false);
  });

  it("rejects proposals outside the packet boundary and apply requests", async () => {
    const unknownFile = await reasonOverReviewPacket({
      reviewPacket: reviewPacket(),
      participant: localParticipant(JSON.stringify(validProposal("package.json"))),
    });
    expect(unknownFile).toMatchObject({ ok: false, status: "invalid-output", attempts: 1 });

    const applyRequested = await reasonOverReviewPacket({
      reviewPacket: reviewPacket(),
      participant: localParticipant(JSON.stringify({
        ...validProposal(),
        applyRequested: true,
      })),
    });
    expect(applyRequested).toMatchObject({ ok: false, status: "invalid-output", attempts: 1 });
  });

  it("returns structured failures for invalid JSON and unavailable local models", async () => {
    const invalidJson = await reasonOverReviewPacket({
      reviewPacket: reviewPacket(),
      participant: localParticipant("not json"),
    });
    expect(invalidJson).toMatchObject({
      ok: false,
      status: "invalid-output",
      attempts: 1,
    });

    const unavailable = await reasonOverReviewPacket({
      reviewPacket: reviewPacket(),
      participant: null,
    });
    expect(unavailable).toMatchObject({
      ok: false,
      status: "unavailable",
      attempts: 0,
    });

    const remote = await reasonOverReviewPacket({
      reviewPacket: reviewPacket(),
      participant: {
        runtime: "remote",
        generate: vi.fn(),
      },
    });
    expect(remote).toMatchObject({
      ok: false,
      status: "unavailable",
      attempts: 0,
    });
  });

  it("makes at most one inference attempt when the local model fails", async () => {
    const participant = localParticipant("");
    participant.generate.mockRejectedValueOnce(new Error("WebGPU unavailable"));

    const result = await reasonOverReviewPacket({
      reviewPacket: reviewPacket(),
      participant,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "inference-failed",
      attempts: 1,
    });
    expect(participant.generate).toHaveBeenCalledTimes(1);
  });
});