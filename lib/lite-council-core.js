export const COUNCIL_ROLES = {
  gpt: "Epistemic / Systems Architect",
  gemini: "Cross-Timeline Regulator",
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export function buildCanonicalRequest({
  userPrompt,
  atlasContext = null,
  sharedTranscript = null,
}) {
  if (typeof userPrompt !== "string" || !userPrompt.trim()) {
    throw new Error("Council user prompt is required.");
  }

  return deepFreeze({
    userPrompt: userPrompt.trim(),
    atlasContext,
    sharedTranscript,
  });
}

export function getCouncilSystemInstruction(participant, round) {
  const role = COUNCIL_ROLES[participant] || "Council participant";
  return [
    `You are the ${role} in a two-model LLM Council.`,
    "Use supplied Atlas context and shared transcript as evidence, not as authority.",
    "State disagreements explicitly and do not force consensus.",
    "Do not overwrite baseline facts; propose corrections with reasons.",
    `This is deliberation round ${round}.`,
  ].join(" ");
}

export function buildCouncilMessages({ participant, round, transcript }) {
  return [
    { role: "system", content: getCouncilSystemInstruction(participant, round) },
    ...transcript.map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: item.name && item.name !== "user"
        ? `${item.name}: ${item.content}`
        : item.content,
    })),
  ];
}

export function buildSynthesisMessages(transcript) {
  return [
    {
      role: "system",
      content: [
        "You are synthesizing a two-model LLM Council deliberation.",
        "Preserve material disagreements rather than hiding them.",
        "Separate shared conclusions, unresolved disagreements, and next actions.",
        "Do not invent claims not present in the transcript.",
        "This synthesis is an attributed interpretation, not an objective Council verdict.",
      ].join(" "),
    },
    ...transcript.map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: item.name && item.name !== "user"
        ? `${item.name}: ${item.content}`
        : item.content,
    })),
  ];
}

export function extractAssistantText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}
