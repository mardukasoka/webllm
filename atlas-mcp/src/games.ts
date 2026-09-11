import { getRepo } from './registry.js';
import { runRepoAction } from './runner.js';

type RulesProfile = {
  id: string;
  attribution?: string;
  date?: number;
  status?: string;
  confidence?: string;
  note?: string;
};

export type GameRecord = {
  id: string;
  name: string;
  family: string;
  sortEra: number;
  origin?: string;
  implementation?: string;
  uncertainty?: string;
  timelineEligible?: boolean;
  authors?: string[];
  rulesProfiles?: RulesProfile[];
};

async function loadCatalog(): Promise<GameRecord[]> {
  const repo = getRepo('chess-atlas');
  if (!repo) throw new Error("Chess Atlas repository is not registered.");

  const result = await runRepoAction(repo, 'catalog');
  if (result.timedOut) throw new Error('Chess Atlas catalog query timed out.');
  if (result.exitCode !== 0) {
    throw new Error(`Chess Atlas catalog query failed: ${result.stderr || `exit code ${result.exitCode}`}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('Chess Atlas catalog returned invalid JSON.');
  }

  if (!Array.isArray(parsed)) throw new Error('Chess Atlas catalog did not return an array.');
  return parsed as GameRecord[];
}

export async function listGames(input: {
  family?: string;
  timelineOnly?: boolean;
}): Promise<GameRecord[]> {
  const catalog = await loadCatalog();
  return catalog.filter((game) => {
    if (input.family && game.family !== input.family) return false;
    if (input.timelineOnly && game.timelineEligible === false) return false;
    return true;
  });
}

export async function getGame(gameId: string): Promise<GameRecord> {
  const catalog = await loadCatalog();
  const game = catalog.find((item) => item.id === gameId);
  if (!game) throw new Error(`Unknown Chess Atlas game '${gameId}'. Use games.list first.`);
  return game;
}

export async function listRulesets(gameId?: string) {
  const catalog = await loadCatalog();
  const games = gameId ? catalog.filter((game) => game.id === gameId) : catalog;

  if (gameId && games.length === 0) {
    throw new Error(`Unknown Chess Atlas game '${gameId}'. Use games.list first.`);
  }

  return games.flatMap((game) =>
    (game.rulesProfiles ?? []).map((ruleset) => ({
      gameId: game.id,
      gameName: game.name,
      family: game.family,
      gameOrigin: game.origin,
      gameUncertainty: game.uncertainty,
      ...ruleset
    }))
  );
}
