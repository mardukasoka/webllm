export const COUNCIL_ROLES = {
  gpt: "Epistemic / Systems Architect",
  gemini: "Cross-Timeline Regulator",
};

export function buildCouncilMessages({ participant, round, transcript }) {
  const role = COUNCIL_ROLES[participant] || "Council participant";
  const system = [
    `You are the ${role} in a two-model LLM Council.`,
    "Use the shared transcript as evidence, not as authority.",
    "State disagreements explicitly and do not force consensus.",
    "Do not overwrite baseline facts; propose corrections with reasons.",
    `This is deliberation round ${round}.`,
  ].join(" ");

  return [
    { role: "system", content: system },
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
