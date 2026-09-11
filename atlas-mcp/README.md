# Atlas MCP v0.1

A small MCP gateway for exposing selected Atlas repositories to the Council through explicit, allowlisted actions.

## Design rules

- Capabilities are exposed, not arbitrary shell access.
- Every executable action is registered in `src/registry.ts`.
- Commands are launched with `shell: false`.
- Repository paths are resolved beneath `ATLAS_REPO_ROOT`.
- Output is bounded and actions time out.
- Repositories may be registered before they gain executable actions.

## Current tools

- `atlas.status` — report gateway configuration.
- `repos.list` — list registered repos and actions.
- `repos.run` — run one allowlisted action.

## Initial registry

- `map3d` — mapping — `build`
- `webllm` — council — `test`, `lint`
- `chess-atlas` — games — registered, execution actions pending verification
- `atoms` — physics — registered, execution actions pending verification

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

1. Add verified `chess-atlas` test/query actions.
2. Add Atoms render/query actions rather than merely launching its UI.
3. Extract a headless Map3D generation/export API so MCP can request OSM → geometry → GLB directly.
4. Add Julia/physics services behind narrow schemas.
5. Add HTTP transport once the stdio contract is stable and deployment/authentication are defined.
