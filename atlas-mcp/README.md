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

There is no persistent background worker, remote AI provider, or public MCP transport in v0.1; recurring behavior is limited to the in-memory schedule timers described above.

### Scheduler

- `scheduler.create` — create an enabled recurring schedule for an existing bounded task mapping.
- `scheduler.list` — list in-memory schedules.
- `scheduler.get` — inspect one schedule.
- `scheduler.enable` / `scheduler.disable` — control its timer.
- `scheduler.run_now` — trigger one occurrence immediately through `agents.submit`.
- `scheduler.remove` — remove a schedule and its timer.

The scheduler is an in-memory timer manager. Intervals must be between 15 minutes and 10080 minutes (one week); schedules disappear when the MCP process restarts. Only enabled schedules are timed, overlapping runs are skipped, and a running task is never killed by the scheduler. The scheduler never bypasses `agents.submit`, never constructs commands, and never performs automatic repairs.

```text
Council
   |
Atlas MCP
   |
Scheduler
   |
agents.submit
   |
Allowlisted runner
   |
Tests / lint / audits
```

There are no Git writes, remote AI calls, swarm workers, autonomous code edits, or continuous high-frequency loops. Future worker/scheduler persistence can be added behind this same bounded task boundary.

### Proposal-only debugger

- `debugger.create` — create an advisory diagnostic from one failed bounded task.
- `debugger.status` — inspect diagnostic state and bounded evidence.
- `debugger.result` — retrieve the completed diagnosis and remediation proposal.

The debugger follows this explicit flow:

```text
failed bounded task
        |
        v
debugger.create
        |
        v
bounded task evidence
        |
        v
deterministic diagnosis
        |
        v
proposal only
```

Diagnostic evidence is limited to the task registry: repository, task type, mapped action, exit code, signal, timeout state, bounded stdout/stderr summaries, task error, and timestamps. The initial classifier recognizes timeout, test-failure, lint-failure, typecheck-failure, and generic execution-failure categories.

The debugger does not:

- write code or files;
- perform Git operations, create branches, commits, or pull requests;
- inspect arbitrary repository paths;
- invoke a remote LLM or provider;
- retry the failed task;
- execute a proposed remediation;
- recursively create more diagnostics.

Scheduler integration is intentionally not automatic in this increment. A caller must explicitly invoke `debugger.create` for a failed task.

### Read-only specialist

- `specialist.inspect` — create a bounded repository evidence packet from one completed debugger diagnostic.
- `specialist.status` — inspect the in-memory inspection state.
- `specialist.result` — retrieve the completed evidence packet.

The specialist preserves a deliberate epistemic boundary:

```text
task failure
        |
        v
debugger
        |
        v
bounded diagnosis
        |
        v
specialist
        |
        v
allowlisted repository evidence
        |
        v
Council/model reasoning
```

The debugger determines what kind of failure occurred. The specialist gathers controlled evidence. Council/model reasoning comes later. This separation is intentional.

`specialist.inspect` accepts only a completed diagnostic ID. It never accepts caller-supplied paths, globs, directories, commands, prompts, URLs, providers, models, scripts, or environment variables. For the known WebLLM test failure, the static allowlist is:

```text
tests/models.test.js
tests/sessions.test.js
lib/models.js
lib/sessions.js
```

The reader uses the registered repository root, verifies containment and real paths, reads regular UTF-8 files only, and enforces a maximum of 6 files, 20,000 bytes per file, and 60,000 bytes total. Oversized files produce bounded excerpts with `truncated: true`. Lint and other categories return `inspection-unavailable` unless a safe static allowlist is added.

The specialist does not write files, generate patches, execute commands, call remote providers, invoke models, retry tasks, create Git objects, or run autonomous loops.

### Local Council review reasoner

The browser-side `lib/council-review-reasoner.js` bridge consumes a prepared Council review packet through the existing local Council path:

```text
createLocalCouncilParticipant()
        |
        v
getRuntimeAdapter(def.runtime).generateAgent
        |
        v
generateCouncilParticipant()
        |
        v
bounded review packet → proposal candidate
```

For the configured default local model, `lfm2`, this reaches `generateLfmAssistant` through the existing `lfm2` runtime adapter. The reasoner supplies one fixed read-only system instruction, passes no callable tools, makes at most one inference attempt, conservatively parses raw or fully fenced JSON, and returns a structured unavailable or invalid-output result when local inference cannot produce a proposal candidate. It does not fall back to a remote or Anthropic provider.

The reasoner accepts only the packet produced by `council.prepare_review`; it does not accept a caller system prompt, repository root, filesystem access, credentials, shell access, URLs, environment variables or MCP execution capabilities. Its output remains a candidate until `council.record_proposal` performs the authoritative validation. This increment keeps the bridge callable from code and tests only because the browser has no existing MCP transport; no patch-apply control is exposed in the UI.

### Council review boundary

- `council.prepare_review` — create a provenance-bound model-facing review packet from one completed specialist inspection.
- `council.review_status` — inspect one in-memory review, its evidence digest, validation state and stored proposal.
- `council.record_proposal` — validate and store one structured proposal against the review evidence.

The Council boundary is intentionally split from reasoning and remediation:

```text
specialist evidence
        |
        v
Council review packet
        |
        v
external Council reasoning
        |
        v
structured proposal
        |
        v
MCP validation
        |
        v
stored proposal only
```

The review packet contains only the registered repository id, source task id, diagnostic category and summary, bounded stdout/stderr, static allowlisted file contents, task context, allowed files, fixed instructions and the proposal output schema. It does not expose repository roots, arbitrary paths, environment variables, credentials, shell commands, arbitrary URLs, provider fields or model fields.

The model can reason; MCP can validate. Neither may apply a patch in v0.1. MCP does not invoke an LLM or provider in this layer. Proposals are limited to 4 inspected files, 12,000 UTF-8 bytes per unified diff, and 40,000 UTF-8 bytes total. Proposed paths must exactly match the review's allowlist. Diffs are checked for file headers and rejected for traversal, binary patches, renames, creation or deletion markers. Recommended tests are limited to the existing `npm test` and `npm run lint` actions.

Every review stores a deterministic SHA-256 evidence digest covering the inspection id, source task id, allowed files, file contents, diagnostic category and diagnostic summary. A valid proposal moves the review from `prepared` to `proposed`; invalid proposals move it to `rejected`. No proposal is written, staged, tested, committed, pushed or applied.

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
