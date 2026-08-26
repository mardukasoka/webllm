export const COUNCIL_MODES = Object.freeze({
  SOLO: "solo",
  ROUNDTABLE: "roundtable",
  COUNCIL: "council",
});

export function createRoundtableSession({
  participants = [],
  maxRounds = 2,
} = {}) {
  return {
    mode: COUNCIL_MODES.ROUNDTABLE,
    participants: [...participants],
    transcript: [],
    currentSpeaker: null,
    round: 0,
    maxRounds,
    status: "idle",
  };
}

export function addRoundtableMessage(
  session,
  {
    role,
    speaker,
    content,
    model = null,
    metadata = null,
  }
) {
  if (!session || !Array.isArray(session.transcript)) {
    throw new Error("Invalid roundtable session.");
  }

  if (!role || !speaker || typeof content !== "string") {
    throw new Error("Invalid roundtable message.");
  }

  const message = {
    id: crypto.randomUUID(),
    role,
    speaker,
    model,
    content,
    timestamp: Date.now(),
    metadata,
  };

  session.transcript.push(message);

  return message;
}

export function getSharedTranscript(session) {
  if (!session || !Array.isArray(session.transcript)) {
    return [];
  }

  return session.transcript.map((message) => ({
    role: message.role,
    name: message.speaker,
    content: message.content,
  }));
}

export async function runRoundtable({
  session,
  userMessage,
  generateForParticipant,
  signal,
}) {
  if (!session) {
    throw new Error("Roundtable session is required.");
  }

  if (typeof generateForParticipant !== "function") {
    throw new Error("generateForParticipant must be a function.");
  }

  addRoundtableMessage(session, {
    role: "user",
    speaker: "user",
    content: userMessage,
  });

  session.status = "running";

  try {
    for (
      let round = 0;
      round < session.maxRounds;
      round += 1
    ) {
      session.round = round + 1;

      for (const participant of session.participants) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        session.currentSpeaker =
          participant.name || participant.id;

        const transcript =
          getSharedTranscript(session);

        const response =
          await generateForParticipant({
            participant,
            transcript,
            round: session.round,
            signal,
          });

        if (!response) continue;

        addRoundtableMessage(session, {
          role: "assistant",
          speaker:
            participant.name || participant.id,
          model:
            participant.model || participant.id,
          content:
            typeof response === "string"
              ? response
              : response.content || "",
          metadata:
            typeof response === "object"
              ? response.metadata || null
              : null,
        });
      }
    }

    session.status = "complete";
    session.currentSpeaker = null;

    return session;
  } catch (error) {
    session.status =
      error?.name === "AbortError"
        ? "stopped"
        : "error";

    session.currentSpeaker = null;

    throw error;
  }
}