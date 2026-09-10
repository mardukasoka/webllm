const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const GEMINI_GENERATE_BASE = "https://generativelanguage.googleapis.com";

function serializeCanonicalRequest(request) {
  const blocks = [
    `[USER PROMPT]\n${request.userPrompt}`,
  ];

  if (request.atlasContext != null) {
    blocks.push(`[ATLAS CONTEXT]\n${JSON.stringify(request.atlasContext)}`);
  }

  if (request.sharedTranscript != null) {
    blocks.push(`[SHARED COUNCIL TRANSCRIPT]\n${JSON.stringify(request.sharedTranscript)}`);
  }

  return blocks.join("\n\n");
}

export function extractOpenAIResponseText(payload) {
  if (!Array.isArray(payload?.output)) return "";

  return payload.output
    .flatMap(item => Array.isArray(item?.content) ? item.content : [])
    .filter(block => block?.type === "output_text" || typeof block?.text === "string")
    .map(block => typeof block.text === "string" ? block.text : "")
    .join("")
    .trim();
}

export function extractGeminiResponseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .map(part => typeof part?.text === "string" ? part.text : "")
    .join("")
    .trim();
}

export async function callOpenAIResponses({
  apiKey,
  model = "gpt-5.6-sol",
  instructions,
  canonicalRequest,
  endpoint = OPENAI_RESPONSES_ENDPOINT,
  signal,
}) {
  if (!apiKey) throw new Error("OpenAI API key is required.");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions,
      input: serializeCanonicalRequest(canonicalRequest),
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI ${response.status}: ${detail || response.statusText}`);
  }

  const payload = await response.json();
  const text = extractOpenAIResponseText(payload);
  if (!text) throw new Error("OpenAI returned no output text.");
  return text;
}

export async function callGeminiGenerateContent({
  apiKey,
  model = "gemini-3.8-flash",
  systemInstruction,
  canonicalRequest,
  baseEndpoint = GEMINI_GENERATE_BASE,
  signal,
}) {
  if (!apiKey) throw new Error("Gemini API key is required.");

  const targetUrl = `${baseEndpoint}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: serializeCanonicalRequest(canonicalRequest) }],
        },
      ],
      generationConfig: {
        temperature: 0.3,
      },
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini ${response.status}: ${detail || response.statusText}`);
  }

  const payload = await response.json();
  const text = extractGeminiResponseText(payload);
  if (!text) throw new Error("Gemini returned no output text.");
  return text;
}
