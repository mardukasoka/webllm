import { describe, expect, it, vi } from "vitest";
import {
  collectFederatedCandidates,
  discoverFederatedModels,
} from "../lib/provider-federation.js";

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

describe("provider federation", () => {
  it("discovers OpenAI-compatible model ids", async () => {
    const fetchImpl = vi.fn(async () => okJson({
      data: [
        { id: "anthropic/claude", owned_by: "anthropic" },
        { id: "google/gemini", owned_by: "google" },
      ],
    }));

    const models = await discoverFederatedModels({
      baseUrl: "https://example.test/",
      apiKey: "secret",
      fetchImpl,
    });

    expect(models).toEqual([
      { id: "anthropic/claude", ownedBy: "anthropic" },
      { id: "google/gemini", ownedBy: "google" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("collects candidates without ranking or winner selection", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      return okJson({
        choices: [{ message: { role: "assistant", content: `answer:${body.model}` } }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      });
    });

    const candidates = await collectFederatedCandidates({
      baseUrl: "https://example.test",
      apiKey: "secret",
      modelIds: ["model-a", "model-b"],
      messages: [{ role: "user", content: "question" }],
      fetchImpl,
    });

    expect(candidates.map((candidate) => candidate.model)).toEqual(["model-a", "model-b"]);
    expect(candidates.every((candidate) => candidate.ok)).toBe(true);
    expect(candidates.some((candidate) => "winner" in candidate || "score" in candidate || "rank" in candidate)).toBe(false);
  });

  it("disables G0DM0D3 transformation, telemetry-dataset, and ranking pipeline fields", async () => {
    const bodies = [];
    const fetchImpl = vi.fn(async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return okJson({ choices: [{ message: { content: "bounded candidate" } }] });
    });

    await collectFederatedCandidates({
      baseUrl: "https://godmode.example",
      apiKey: "secret",
      modelIds: ["openai/gpt", "google/gemini"],
      messages: [{ role: "user", content: "compare this" }],
      providerKind: "g0dm0d3",
      fetchImpl,
    });

    for (const body of bodies) {
      expect(body.godmode).toBe(false);
      expect(body.autotune).toBe(false);
      expect(body.parseltongue).toBe(false);
      expect(body.stm_modules).toEqual([]);
      expect(body.contribute_to_dataset).toBe(false);
    }
  });

  it("keeps provider failures as candidate results instead of silently falling back", async () => {
    const fetchImpl = vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      if (body.model === "bad-model") {
        return {
          ok: false,
          status: 503,
          statusText: "Unavailable",
          async text() { return "provider down"; },
        };
      }
      return okJson({ choices: [{ message: { content: "ok" } }] });
    });

    const candidates = await collectFederatedCandidates({
      baseUrl: "https://example.test",
      apiKey: "secret",
      modelIds: ["good-model", "bad-model"],
      messages: [{ role: "user", content: "question" }],
      fetchImpl,
    });

    expect(candidates[0]).toMatchObject({ model: "good-model", ok: true });
    expect(candidates[1]).toMatchObject({ model: "bad-model", ok: false });
  });
});
