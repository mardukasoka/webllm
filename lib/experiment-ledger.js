/**
 * Pure, append-only experiment planning/evaluation helpers.
 *
 * This module deliberately performs no repository writes, model calls, shell
 * execution, scheduling, or automatic retries. It only validates experiment
 * metadata and evaluates a completed numeric metric against a declared goal.
 */

const DIRECTIONS = new Set(["maximize", "minimize"]);
const DISPOSITIONS = new Set(["keep", "reject", "inconclusive"]);

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function requireFinite(value, label) {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

export function createExperimentPlan({
  experimentId,
  goal,
  hypothesis,
  metric,
  direction,
  baseline,
  minimumDelta = 0,
  sourceCommit,
  parameters = {},
}) {
  const normalizedDirection = requireText(direction, "direction");
  if (!DIRECTIONS.has(normalizedDirection)) {
    throw new Error("direction must be 'maximize' or 'minimize'.");
  }

  requireFinite(baseline, "baseline");
  requireFinite(minimumDelta, "minimumDelta");
  if (minimumDelta < 0) {
    throw new Error("minimumDelta must be >= 0.");
  }

  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
    throw new Error("parameters must be a plain object.");
  }

  return Object.freeze({
    experimentId: requireText(experimentId, "experimentId"),
    goal: requireText(goal, "goal"),
    hypothesis: requireText(hypothesis, "hypothesis"),
    metric: requireText(metric, "metric"),
    direction: normalizedDirection,
    baseline,
    minimumDelta,
    sourceCommit: requireText(sourceCommit, "sourceCommit"),
    parameters: Object.freeze({ ...parameters }),
  });
}

export function evaluateExperiment(plan, result) {
  if (!plan?.experimentId) {
    throw new Error("A valid experiment plan is required.");
  }
  if (!result || typeof result !== "object") {
    throw new Error("An experiment result is required.");
  }

  const status = result.status;
  if (status !== "completed") {
    return Object.freeze({
      ...plan,
      status: typeof status === "string" ? status : "unknown",
      observed: null,
      delta: null,
      disposition: "inconclusive",
      reason: requireText(result.reason || "Experiment did not complete.", "reason"),
    });
  }

  const observed = requireFinite(result.observed, "observed");
  const signedDelta = plan.direction === "maximize"
    ? observed - plan.baseline
    : plan.baseline - observed;

  let disposition;
  let reason;
  if (signedDelta >= plan.minimumDelta) {
    disposition = "keep";
    reason = `Metric improved by ${signedDelta}, meeting the required delta ${plan.minimumDelta}.`;
  } else if (signedDelta < 0) {
    disposition = "reject";
    reason = `Metric regressed by ${Math.abs(signedDelta)}.`;
  } else {
    disposition = "inconclusive";
    reason = `Metric improved by ${signedDelta}, below the required delta ${plan.minimumDelta}.`;
  }

  return Object.freeze({
    ...plan,
    status,
    observed,
    delta: signedDelta,
    disposition,
    reason,
  });
}

export function appendExperimentRecord(ledger, evaluated) {
  if (!Array.isArray(ledger)) {
    throw new Error("ledger must be an array.");
  }
  if (!evaluated?.experimentId || !DISPOSITIONS.has(evaluated.disposition)) {
    throw new Error("A valid evaluated experiment is required.");
  }
  if (ledger.some((entry) => entry.experimentId === evaluated.experimentId)) {
    throw new Error(`Experiment '${evaluated.experimentId}' already exists in the ledger.`);
  }
  return Object.freeze([...ledger, Object.freeze({ ...evaluated })]);
}
