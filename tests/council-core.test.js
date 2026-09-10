import { describe, expect, it } from "vitest";
import {
  createRoundtableSession,
  runRoundtable,
} from "../lib/council-core.js";

describe("Council round execution", () => {
  it("gives every participant the same frozen transcript snapshot per round", async () => {
    const session = createRoundtableSession({
      participants: [
        { id: "a", name: "A", runtime: "test" },
        { id: "b", name: "B", runtime: "test" },
      ],
      maxRounds: 1,
    });

    const seen = [];
    await runRoundtable({
      session,
      userMessage: "Question",
      generateForParticipant: async ({ participant, transcript }) => {
        seen.push({ participant: participant.id, transcript });
        expect(Object.isFrozen(transcript)).toBe(true);
        expect(Object.isFrozen(transcript[0])).toBe(true);
        return { content: `answer-${participant.id}` };
      },
    });

    expect(seen).toHaveLength(2);
    expect(seen[0].transcript).toEqual(seen[1].transcript);
    expect(seen[0].transcript).toHaveLength(1);
    expect(seen[0].transcript[0].content).toBe("Question");
  });

  it("records one participant failure without cancelling the other", async () => {
    const session = createRoundtableSession({
      participants: [
        { id: "a", name: "A", runtime: "test" },
        { id: "b", name: "B", runtime: "test" },
      ],
      maxRounds: 1,
    });

    await runRoundtable({
      session,
      userMessage: "Question",
      generateForParticipant: async ({ participant }) => {
        if (participant.id === "a") throw new Error("offline");
        return { content: "survived" };
      },
    });

    expect(session.status).toBe("complete");
    expect(session.transcript).toHaveLength(3);
    expect(session.transcript[1].content).toContain("Execution failure: offline");
    expect(session.transcript[1].metadata?.error).toBe(true);
    expect(session.transcript[2].content).toBe("survived");
  });
});
