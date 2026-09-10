import { describe, expect, it } from "vitest";
import {
  extractGeminiResponseText,
  extractOpenAIResponseText,
} from "../lib/lite-council-provider.js";

describe("lite council provider adapters", () => {
  it("extracts text from OpenAI Responses output items", () => {
    expect(extractOpenAIResponseText({
      output: [
        { type: "reasoning", content: [] },
        {
          type: "message",
          content: [
            { type: "output_text", text: " first" },
            { type: "output_text", text: " second " },
          ],
        },
      ],
    })).toBe("first second");
  });

  it("extracts all Gemini text parts", () => {
    expect(extractGeminiResponseText({
      candidates: [{
        content: {
          parts: [{ text: "alpha" }, { text: " beta" }],
        },
      }],
    })).toBe("alpha beta");
  });

  it("returns empty text for malformed provider payloads", () => {
    expect(extractOpenAIResponseText({})).toBe("");
    expect(extractGeminiResponseText({})).toBe("");
  });
});
