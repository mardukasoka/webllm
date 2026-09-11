# Atlas MCP v0.1

A small MCP gateway for exposing selected Atlas repositories to the Council through explicit, allowlisted actions and structured domain tools.

## Design rules

- Capabilities are exposed, not arbitrary shell access.
- Every executable repository action is registered in `src/registry.ts`.
- Commands are launched with `shell: false`.
- Repository paths are resolved beneath `ATLAS_REPO_ROOT`.
- Output is bounded and actions time out.
- Structured tools validate inputs and preserve provenance/epistemic distinctions.
- Repositories may be registered before they gain executable actions.
- The MCP is a control plane: task execution still routes through reviewed, allowlisted actions.
- v0.1 agent tasks are in-memory, have bounded lifetimes, and do not create autonomous agents.

## Current tools

### Gateway

- `atlas.status` — report gateway configuration and structured tools.
- `repos.list` — list registered repos and allowlisted actions.
- `repos.run` — run one allowlisted repository action.

### Mapping

- `map3d.plan` — validate a small geographic bounding box and produce the Map3D OpenStreetMap/Overpass request plan. It does not fetch, render, or export GLB.

### Physics

- `atoms.describe` — describe the current lightweight electronic/muonic hydrogen visualizer state for validated `n`, `l`, `m` quantum numbers. It exposes model semantics but does not invoke the browser renderer or claim precision bound-state calculation.

### Games

- `games.list` — list canonical Chess Atlas game records in chronological order, optionally filtered by family or timeline eligibility.
- `games.get` — return one canonical game record by stable id.
- `games.rulesets` — return attributed historical/reconstructed rules profiles, optionally for one game.

The Games tools are query-only in v0.1. Move generation, move application and engine evaluation are intentionally not exposed until their rules-engine adapter boundaries are verified.

### Agent control plane

- `agents.submit` — create a bounded in-memory task using a predefined repository/action mapping.
- `agents.status` — inspect task metadata and state.
- `agents.result` — retrieve bounded output after a task reaches a terminal state.
- `agents.cancel` — cancel queued tasks; running subprocesses are not killed in v0.1.

Tasks accept only a task type, registered repository, write-mode metadata, agent-count policy, and timeout metadata. They do not accept commands, arguments, paths, URLs, credentials, or scripts. `maxAgents` is a policy field only; v0.1 does not spawn LLMs or agent swarms. `branch-only` is metadata only and no Git writes are implemented.

Persistence is intentionally deferred. Tasks are lost when the MCP process restarts. A future worker/scheduler architecture can add durable coordination without changing the allowlisted action boundary:

```text
Council
   |
Atlas MCP
   |
agents.*
   |
Allowlisted Task Runner
   |
Repo/Test/Audit capability
```

There is no continuous scheduler, persistent background worker, remote AI provider, or public MCP transport in v0.1.

## Initial registry

- `map3d` — mapping — `build`
- `webllm` — council — `test`, `lint`
- `chess-atlas` — games — `catalog`
- `atoms` — physics — no executable repo action; structured description is implemented in MCP

## Run locally

The host machine should contain repo checkouts under one parent directory, for example:

```text
/opt/atlas-repos/
  webllm/
  map3d/
  chess-atlas/
  Atoms/
```

Then:

```bash
cd webllm/atlas-mcp
npm install
ATLAS_REPO_ROOT=/opt/atlas-repos npm start
```

The server uses MCP stdio transport. Configure an MCP host to launch the command above.

## Why actions are allowlisted

The Council should invoke well-defined capabilities, not receive general terminal access. Add a new repo action only after its command, working directory, expected inputs and resource limits have been reviewed.

## Next integrations

1. Verify `games.list`, `games.get` and `games.rulesets` end-to-end through the MCP runtime.
2. Add a read-only `games.available_actions` adapter only for rules engines that already expose validated legal actions.
3. Add Atoms precision/query services separately from the lightweight visualizer semantics.
4. Extract a headless Map3D generation/export API so MCP can request OSM → geometry → GLB directly.
5. Add Julia/physics services behind narrow schemas.
6. Add HTTP transport once the stdio contract is stable and deployment/authentication are defined.
