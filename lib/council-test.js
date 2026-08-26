import {
  createRoundtableSession,
  runRoundtable,
} from "./council-core.js";

import {
  generateCouncilParticipant,
} from "./council-provider.js";

export async function testRoundtable({
  participants,
  userMessage = "Suggest one improvement to this project.",
  maxRounds = 2,
  signal,
}) {
  const session = createRoundtableSession({
    participants,
    maxRounds,
  });

  await runRoundtable({
    session,
    userMessage,
    generateForParticipant:
      generateCouncilParticipant,
    signal,
  });

  return session;
}