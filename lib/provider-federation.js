/**
 * Provider federation helpers for Council candidate collection.
 *
 * Inspired by G0DM0D3's provider aggregation, but deliberately excludes
 * jailbreak prompt injection, response scoring/ranking, winner selection,
 * telemetry, dataset contribution, and automatic fallback.
 */

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("baseUrl is required.");
  }
  return value.trim().replace(/\/+$/, "");
}

function requireApiKey(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("apiKey is required.");
  }
  return value.trim();
}

function safeProviderBody(providerKind) {
  if (providerKind !== "g0dm0d3") return {};
  return {
    godmode: false,
    autotune: false,
    parseltongue: false,
    stm_modules: [],
    contribute_to_dataset: false,
  };
}

export async function discoverFederatedModels({
  baseUrl,
  apiKey,
  fetchImpl = globalThis.fetch,
}) {
  const root = normalizeBaseUrl(baseUrl);
  const key = requireApiKey(apiKey);
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required.");

  const response = await fetchImpl(`${root}/v1/models`, {
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Provider model discovery failed (${response.status}): ${detail || response.statusText}`);
  }

  const data = await response.json();
  if (!Array.isArray(data?.data)) {
    throw new Error("Provider returned an invalid model list.");
  }

  return data.data
    .filter((item) => typeof item?.id === "string" && item.id.trim())
    .map((item) => ({
      id: item.id,
      ownedBy: typeof item.owned_by === "string" ? item.owned_by : null,
    }));
}

export async function collectFederatedCandidates({
  baseUrl,
  apiKey,
  modelIds,
  messages,
  maxTokens = 1024,
  providerKind = "openai-compatible",
  fetchImpl = globalThis.fetch,
}) {
  const root = normalizeBaseUrl(baseUrl);
  const key = requireApiKey(apiKey);
  if (!Array.isArray(modelIds) || modelIds.length < 1 || modelIds.length > 8) {
    throw new Error("modelIds must contain between 1 and 8 models.");
  }
  if (new Set(modelIds).size !== modelIds.length) {
    throw new Error("modelIds must be unique.");
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array.");
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) {
    throw new Error("maxTokens must be an integer between 1 and 8192.");
  }
  if (!["openai-compatible", "g0dm0d3"].includes(providerKind)) {
    throw new Error("providerKind must be 'openai-compatible' or 'g0dm0d3'.");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required.");

  const extension = safeProviderBody(providerKind);

  const jobs = modelIds.map(async (modelId) => {
    if (typeof modelId !== "string" || !modelId.trim()) {
      return { model: String(modelId), ok: false, error: "Invalid model id." };
    }

    try {
      const response = await fetchImpl(`${root}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: maxTokens,
          ...extension,
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        return {
          model: modelId,
          ok: false,
          error: `HTTP ${response.status}: ${detail || response.statusText}`,
        };
      }

      const data = await response.json();
      const message = data?.choices?.[0]?.message;
      if (!message || typeof message.content !== "string") {
        return { model: modelId, ok: false, error: "No assistant text returned." };
      }

      return {
        model: modelId,
        ok: true,
        content: message.content,
        usage: {
          promptTokens: data?.usage?.prompt_tokens ?? null,
          completionTokens: data?.usage?.completion_tokens ?? null,
          totalTokens: data?.usage?.total_tokens ?? null,
        },
      };
    } catch (error) {
      return {
        model: modelId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return Promise.all(jobs);
}
