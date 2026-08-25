/** @file Minimal OpenAI-compatible remote runtime adapter. */

export const REMOTE_TOOL_PROTOCOL =
  "Use the supplied function tools when useful. Never invent tool results.";

function ask(label, fallback = "") {
  const value = globalThis.prompt?.(label, fallback);
  return value == null ? "" : value.trim();
}

export async function loadRemoteModel() {
  const endpoint = ask(
    "OpenAI-compatible chat completions endpoint:",
    "https://api.openai.com/v1/chat/completions"
  );

  const model = ask(
    "Remote model name:",
    "gpt-5"
  );

  const apiKey = ask(
    "API key (kept in memory only):"
  );

  if (!endpoint) throw new Error("Remote endpoint is required.");
  if (!model) throw new Error("Remote model name is required.");
  if (!apiKey) throw new Error("API key is required.");

  return {
    endpoint,
    model,
    apiKey,

    async warmup() {
      // Remote providers do not require browser model warm-up.
    },

    async reset() {},

    async dispose() {
      this.apiKey = "";
    },
  };
}

export function countRemotePromptTokens() {
  // Provider performs authoritative token accounting.
  return null;
}

function normalizeTools(tools = []) {
  return tools
    .map(tool => tool.schema || tool)
    .filter(Boolean);
}

export async function generateRemoteAssistant({
  model,
  messages,
  tools = [],
  maxNewTokens,
  signal,
  onStream,
  onRequestPrepared,
}) {
  if (!model?.endpoint || !model?.model || !model?.apiKey) {
    throw new Error("Remote AI is not configured.");
  }

  const body = {
    model: model.model,
    messages,
    max_tokens: maxNewTokens,
  };

  const normalizedTools = normalizeTools(tools);

  if (normalizedTools.length) {
    body.tools = normalizedTools;
    body.tool_choice = "auto";
  }

  onRequestPrepared?.({
    runtime: "remote",
    endpoint: model.endpoint,
    model: model.model,
    messages,
    tools: normalizedTools,
    maxNewTokens,
  });

  const response = await fetch(model.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Remote API ${response.status}: ${detail || response.statusText}`
    );
  }

  const data = await response.json();
  const choice = data?.choices?.[0];

  if (!choice?.message) {
    throw new Error("Remote API returned no assistant message.");
  }

  const message = {
    role: "assistant",
    content: choice.message.content ?? null,
  };

  if (choice.message.tool_calls?.length) {
    message.tool_calls = choice.message.tool_calls;
  }

  const text =
    typeof message.content === "string"
      ? message.content
      : "";

  if (text) {
    onStream?.({
      text,
      rawText: text,
    });
  }

  return {
    message,
    raw: text,
    metrics: {
      promptTokens: data?.usage?.prompt_tokens ?? null,
      completionTokens: data?.usage?.completion_tokens ?? null,
      totalTokens: data?.usage?.total_tokens ?? null,
    },
    truncated: false,
  };
}