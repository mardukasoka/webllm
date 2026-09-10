import { describe, expect, it } from "vitest";
import {
  buildCouncilMessages,
  buildSynthesisMessages,
  extractAssistantText,
} from "../lib/lite-council-core.js";

describe("lite council core", () => {
  it("labels participant contributions in shared transcript", () => {
    const messages = buildCouncilMessages({
      participant: "gemini",
      round: 2,
      transcript: [
        { role: "user", name: "user", content: "Question" },
        { role: "assistant", name: "GPT", content: "Proposal" },
      ],
    });

    expect(messages[0].content).toContain("Cross-Timeline Regulator");
    expect(messages[0].content).toContain("round 2");
    expect(messages[2].content).toBe("GPT: Proposal");
  });

  it("asks synthesis to preserve disagreements", () => {
    const messages = buildSynthesisMessages([
      { role: "assistant", name: "Gemini", content: "Disagree" },
    ]);

    expect(messages[0].content).toContain("Preserve material disagreements");
    expect(messages[1].content).toBe("Gemini: Disagree");
  });

  it("extracts OpenAI-compatible assistant text", () => {
    expect(extractAssistantText({
      choices: [{ message: { content: "  answer  " } }],
    })).toBe("answer");
    expect(extractAssistantText({})).toBe("");
  });
});
