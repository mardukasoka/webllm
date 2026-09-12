/** @file Minimal Gemini generateContent adapter for Council participants. */

const DEFAULT_API_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-flash";

export async function loadGeminiModel() {
  const apiKey =
    globalThis.prompt?.(
      "Gemini authorization/API key (kept in memory only):"
    )?.trim() || "";

  const model =
    globalThis.prompt?.(
      "Gemini model name:",
      DEFAULT_MODEL
    )?.trim() || "";

  if (!apiKey) throw new Error("Gemini API key is required.");
  if (!model) throw new Error("Gemini model name is required.");

  return {
    apiRoot: DEFAULT_API_ROOT,
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

function normalizeContents(messages = []) {
  return messages
    .filter(message => message.role === "user" || message.role === "assistant")
    .map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content || "" }],
    }));
}

function extractCandidateText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts
        .filter(part => typeof part?.text === "string")
        .map(part => part.text)
        .join("")
    : "";
}

export async function generateGeminiAssistant({
  model,
  messages,
  tools = [],
  maxNewTokens = 1024,
  signal,
  onRequestPrepared,
}) {
  if (!model?.apiKey) throw new Error("Gemini API key is required.");
  if (!model?.model) throw new Error("Gemini model name is required.");
  if (tools.length) {
    throw new Error("Gemini Council review reasoning does not permit callable tools.");
  }

  const systemInstruction = extractSystem(messages);
  const contents = normalizeContents(messages);
  const apiRoot = model.apiRoot || DEFAULT_API_ROOT;
  const endpoint = `${apiRoot}/models/${encodeURIComponent(model.model)}:generateContent`;

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: maxNewTokens,
      responseMimeType: "application/json",
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  onRequestPrepared?.({
    runtime: "gemini",
    endpoint,
    model: model.model,
    body,
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": model.apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gemini API ${response.status}: ${detail || response.statusText}`
    );
  }

  const data = await response.json();
  const text = extractCandidateText(data);
  if (!text) {
    const blocked = data?.promptFeedback?.blockReason;
    throw new Error(
      blocked
        ? `Gemini returned no candidate text (blocked: ${blocked}).`
        : "Gemini returned no candidate text."
    );
  }

  return {
    message: {
      role: "assistant",
      content: text,
    },
    raw: text,
    metrics: {
      promptTokens: data?.usageMetadata?.promptTokenCount ?? null,
      completionTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
      totalTokens: data?.usageMetadata?.totalTokenCount ?? null,
    },
  };
}
