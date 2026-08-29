/** @file Minimal Anthropic Messages API adapter for Council participants. */

const DEFAULT_ENDPOINT =
  "https://api.anthropic.com/v1/messages";

export async function loadAnthropicModel() {
  const apiKey =
    globalThis.prompt?.(
      "Anthropic API key (kept in memory only):"
    )?.trim() || "";

  const model =
    globalThis.prompt?.(
      "Claude model name:",
      "claude-sonnet-5"
    )?.trim() || "";

  if (!apiKey) {
    throw new Error("Anthropic API key is required.");
  }

  if (!model) {
    throw new Error("Claude model name is required.");
  }

  return {
    endpoint: DEFAULT_ENDPOINT,
    model,
    apiKey,

    async dispose() {
      this.apiKey = "";
    },
  };
}

function extractSystem(messages = []) {
  return messages
    .filter(message => message.role === "system")
    .map(message => message.content)
    .filter(Boolean)
    .join("\n\n");
}

function normalizeMessages(messages = []) {
  return messages
    .filter(message =>
      message.role === "user" ||
      message.role === "assistant"
    )
    .map(message => ({
      role: message.role,
      content: message.content || "",
    }));
}

export async function generateAnthropicAssistant({
  model,
  messages,
  maxNewTokens = 1024,
  signal,
}) {
  if (!model?.apiKey) {
    throw new Error("Anthropic API key is required.");
  }

  if (!model?.model) {
    throw new Error("Anthropic model name is required.");
  }

  const system = extractSystem(messages);
  const conversation = normalizeMessages(messages);

  const body = {
    model: model.model,
    max_tokens: maxNewTokens,
    messages: conversation,
  };

  if (system) {
    body.system = system;
  }

  const response = await fetch(
    model.endpoint || DEFAULT_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": model.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal,
    }
  );

  if (!response.ok) {
    const detail =
      await response.text().catch(() => "");

    throw new Error(
      `Anthropic API ${response.status}: ${
        detail || response.statusText
      }`
    );
  }

  const data = await response.json();

  const text = Array.isArray(data?.content)
    ? data.content
        .filter(block => block.type === "text")
        .map(block => block.text || "")
        .join("")
    : "";

  return {
    message: {
      role: "assistant",
      content: text,
    },

    raw: text,

    metrics: {
      promptTokens:
        data?.usage?.input_tokens ?? null,
      completionTokens:
        data?.usage?.output_tokens ?? null,
      totalTokens:
        data?.usage
          ? (data.usage.input_tokens || 0) +
            (data.usage.output_tokens || 0)
          : null,
    },
  };
}