import {
  generateRemoteAssistant,
} from "./remote-adapter.js";

export async function generateCouncilParticipant({
  participant,
  transcript,
  round,
  signal,
}) {
  if (!participant) {
    throw new Error("Council participant is required.");
  }

  if (!participant.runtime) {
    throw new Error(
      `Participant "${participant.name || participant.id}" has no runtime.`
    );
  }

  const messages = [
    {
      role: "system",
      content:
        participant.systemPrompt ||
        [
          "You are participating in an AI Roundtable.",
          "Read the shared conversation carefully.",
          "Respond to the user and to the other participants where useful.",
          "Acknowledge good improvements explicitly.",
          "Challenge weak assumptions when necessary.",
          "Do not force agreement.",
          `This is round ${round}.`,
        ].join(" "),
    },
    ...transcript.map((message) => ({
      role: message.role,
      content:
        message.name && message.name !== "user"
          ? `${message.name}: ${message.content}`
          : message.content,
    })),
  ];

  if (participant.runtime === "remote") {
    if (!participant.modelInstance) {
      throw new Error(
        `Remote participant "${participant.name || participant.id}" is not configured.`
      );
    }

    const result = await generateRemoteAssistant({
      model: participant.modelInstance,
      messages,
      tools: participant.tools || [],
      maxNewTokens:
        participant.maxNewTokens || 1024,
      signal,
    });

    return {
      content:
        result?.message?.content ||
        result?.raw ||
        "",
      metadata: {
        runtime: "remote",
        model:
          participant.modelInstance.model ||
          participant.model ||
          null,
        metrics: result?.metrics || null,
      },
    };
  }

  if (
    typeof participant.generate === "function"
  ) {
    const result =
      await participant.generate({
        messages,
        tools: participant.tools || [],
        signal,
        maxNewTokens:
          participant.maxNewTokens || 1024,
      });

    if (typeof result === "string") {
      return {
        content: result,
        metadata: {
          runtime: participant.runtime,
          model: participant.model || null,
        },
      };
    }

    return {
      content:
        result?.message?.content ||
        result?.content ||
        result?.raw ||
        "",
      metadata: {
        runtime: participant.runtime,
        model: participant.model || null,
        metrics: result?.metrics || null,
      },
    };
  }

  throw new Error(
    `Unsupported Council runtime: ${participant.runtime}`
  );
}