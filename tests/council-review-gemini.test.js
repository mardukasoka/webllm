import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COUNCIL_REVIEW_REASONING_INSTRUCTION,
} from "../lib/council-review-reasoner.js";
import {
  generateGeminiAssistant,
} from "../lib/gemini-adapter.js";
import {
  reasonOverReviewPacketWithGemini,
} from "../lib/council-review-gemini.js";

const allowedFiles = [
  "tests/models.test.js",
  "tests/sessions.test.js",
  "lib/models.js",
  "lib/sessions.js",
];

function reviewPacket() {
  return {
    reviewId: "review-gemini-1",
    repo: "webllm",
    sourceTaskId: "task-1",
    diagnosticCategory: "test-failure",
    diagnosticSummary: "Known bounded test failure.",
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
    summary: "The evidence suggests a test expectation mismatch.",
    rationale: "The change is limited to an inspected file.",
    confidence: "medium",
    changes: [{
      path,
      reason: "Align the inspected expectation with the inspected implementation.",
      unifiedDiff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new`,
    }],
    testsRecommended: ["npm test"],
    applyRequested: false,
  };
}

function participant() {
  return {
    id: "gemini-review",
    name: "Gemini Review Specialist",
    runtime: "gemini",
    modelInstance: {
      apiRoot: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3.8-flash",
      apiKey: "secret-test-key",
    },
  };
}

function mockGeminiResponse(text) {
  return {
    ok: true,
    json: vi.fn(async () => ({
      candidates: [{
        content: {
          role: "model",
          parts: [{ text }],
        },
      }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini Council review bridge", () => {
  it("serializes systemInstruction separately and never places the key in the body", async () => {
    const fetchMock = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(body.systemInstruction).toEqual({
        parts: [{ text: COUNCIL_REVIEW_REASONING_INSTRUCTION }],
      });
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].role).toBe("user");
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(options.headers["x-goog-api-key"]).toBe("secret-test-key");
      expect(options.body).not.toContain("secret-test-key");
      return mockGeminiResponse(JSON.stringify(validProposal()));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateGeminiAssistant({
      model: participant().modelInstance,
      messages: [
        { role: "system", content: COUNCIL_REVIEW_REASONING_INSTRUCTION },
        { role: "user", content: JSON.stringify(reviewPacket()) },
      ],
      tools: [],
    });

    expect(result.message.content).toBe(JSON.stringify(validProposal()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("produces one bounded proposal candidate through the existing Council provider", async () => {
    const fetchMock = vi.fn(async () =>
      mockGeminiResponse(JSON.stringify(validProposal()))
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await reasonOverReviewPacketWithGemini({
      reviewPacket: reviewPacket(),
      participant: participant(),
    });

    expect(result).toMatchObject({
      ok: true,
      status: "proposal-ready",
      attempts: 1,
      proposal: validProposal(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects tool injection and proposals outside allowedFiles", async () => {
    await expect(generateGeminiAssistant({
      model: participant().modelInstance,
      messages: [{ role: "user", content: "hello" }],
      tools: [{ type: "function" }],
    })).rejects.toThrow(/does not permit callable tools/);

    vi.stubGlobal("fetch", vi.fn(async () =>
      mockGeminiResponse(JSON.stringify(validProposal("package.json")))
    ));

    const result = await reasonOverReviewPacketWithGemini({
      reviewPacket: reviewPacket(),
      participant: participant(),
    });
    expect(result).toMatchObject({
      ok: false,
      status: "invalid-output",
      attempts: 1,
    });
  });

  it("rejects apply requests and invalid JSON without fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      mockGeminiResponse(JSON.stringify({
        ...validProposal(),
        applyRequested: true,
      }))
    ));
    const apply = await reasonOverReviewPacketWithGemini({
      reviewPacket: reviewPacket(),
      participant: participant(),
    });
    expect(apply).toMatchObject({ ok: false, status: "invalid-output", attempts: 1 });

    vi.stubGlobal("fetch", vi.fn(async () => mockGeminiResponse("not json")));
    const invalid = await reasonOverReviewPacketWithGemini({
      reviewPacket: reviewPacket(),
      participant: participant(),
    });
    expect(invalid).toMatchObject({ ok: false, status: "invalid-output", attempts: 1 });
  });

  it("returns unavailable when Gemini is not configured", async () => {
    const result = await reasonOverReviewPacketWithGemini({
      reviewPacket: reviewPacket(),
      participant: { runtime: "gemini", modelInstance: null },
    });
    expect(result).toMatchObject({
      ok: false,
      status: "unavailable",
      attempts: 0,
    });
  });
});
