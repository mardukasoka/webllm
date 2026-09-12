# Atlas MCP — New Repository Tasking

This task set extracts useful patterns from the forked `awesome-autoresearch`, `awesome-llm-apps`, and `G0DM0D3` repositories without importing their architectures wholesale.

## Constitutional constraints

- Comparison, not voting: remote providers may return multiple candidates, but no gateway layer selects a winner for the Council.
- Rules/evidence engines remain authoritative in their own domains.
- No autonomous repository writes, production deploys, destructive actions, or training runs without a separately approved capability.
- Provider credentials are BYO and must not be committed, logged, added to datasets, or exposed to model-facing evidence packets.
- G0DM0D3 jailbreak prompts, Parseltongue transforms, automatic winner scoring, telemetry, and dataset contribution are outside the Atlas epistemic path.
- Every optimization loop must declare a measurable metric before execution.

## Increment A — Experiment layer

Status: bounded store implemented; central MCP registration pending.

Source patterns:
- `research-loop`: deterministic runner, isolated worktrees, authoritative metric evaluation, append-only experiment ledger.
- `recursive-improve`: execution traces, failure analysis, keep-or-revert evaluation.
- `goal-md` / `autoresearch-anything`: explicit measurable fitness function before optimization.

Implemented:
- `lib/experiment-ledger.js`
- `atlas-mcp/src/experiments.ts`
- `tests/experiment-ledger.test.js`
- `tests/atlas-experiments.test.js`

Current scope:
- plan validation
- maximize/minimize metrics
- minimum improvement threshold
- `keep`, `reject`, `inconclusive`
- in-memory plan/evaluation registry
- immutable append semantics and duplicate-id rejection
- external execution only; zero repository writes

Next:
1. Register `experiments.create`, `experiments.evaluate`, `experiments.list`, and `experiments.get` in the central MCP server.
2. Link experiment execution only to existing allowlisted `agents.submit` tasks.
3. Extend records with task id and evidence digest after that linkage is verified.
4. Add isolated worktrees only after the evaluation path is verified.

Not authorized:
- persistent storage
- automatic experiment execution
- Git worktrees
- model training
- automatic keep/revert writes

## Increment B — Remote provider federation

Status: collection and Council proposal-envelope bridge implemented; live provider registry pending.

Source pattern:
- `G0DM0D3`: OpenAI-compatible model discovery and provider aggregation across OpenRouter, Venice, and local OpenAI-compatible servers.

Implemented:
- `lib/provider-federation.js`
- `lib/council-federation-review.js`
- `tests/provider-federation.test.js`
- `tests/council-federation-review.test.js`

Current scope:
- OpenAI-compatible `/v1/models` discovery
- bounded parallel collection from 1–8 explicit model ids
- per-model success/failure retained
- G0DM0D3 mode explicitly disables `godmode`, `autotune`, `parseltongue`, STM transforms, and dataset contribution
- successful candidate text must pass the existing strict Council proposal parser
- proposal envelopes preserve review id, evidence digest, provider model, and runtime provenance
- at least two valid proposals are required before entering the existing non-voting comparator
- provider failures and invalid proposal outputs remain visible
- comparison emits no winner, ranking, vote, selected proposal, or merged patch

Next:
1. Add a Council-facing provider registry that stores endpoint/model metadata separately from credentials.
2. Register a bounded federation entry point only after credential handling is verified.
3. Require authoritative `council.record_proposal` validation before any proposal becomes eligible for downstream training data.
4. Add Venice/OpenRouter catalog adapters only when credential handling is verified.
5. Keep local LFM as a first-class peer, not a fallback hidden behind remote routing.

## Increment C — Research specialists

Source patterns:
- `awesome-llm-apps`: trust-gated multi-agent research, advisor/orchestrator/worker, release radar, scope creep and dependency checking.
- `AutoSci` / `AutoResearchClaw` / `NanoResearch`: structured research lifecycle and knowledge graph/wiki patterns.

Plan:
1. Researcher — read/search only, provenance required.
2. Builder — branch/worktree only after approval.
3. Tester — authoritative bounded metrics.
4. Verifier — independent source/tool checks.
5. Council — compare proposals; never majority-vote them into truth.

## Increment D — Distillation dataset

Do not start until A–C are verified.

Dataset record should contain:
- prompt/task
- immutable evidence digest
- all candidate responses retained where terms permit
- provider/model/version provenance
- tool/test/Wolfram/domain-verifier results
- Council comparison dimensions
- human or authoritative disposition
- chosen/rejected pairs only when the choice is justified by explicit metrics/evidence

Initial training strategy:
1. SFT on accepted, verified open-model outputs.
2. Preference optimization (for example DPO-style chosen/rejected pairs) before RL.
3. Reward-model experiments only after benchmark stability.

Provider terms and model/output licenses must be checked before any proprietary-model response is added to a training corpus.

## Verification commands

After syncing `atlas-mcp-v0.1`:

```bash
npm test -- tests/experiment-ledger.test.js tests/atlas-experiments.test.js tests/provider-federation.test.js tests/council-federation-review.test.js tests/council-review-comparison.test.js
npm run lint
cd atlas-mcp && npm run check
```

These increments still do not persist credentials, call live providers automatically, train models, apply proposals, or mutate repositories.
