import { jsonResponse } from "./owner-auth.mjs";

const LEGACY_PARENT_COMMIT = "05670bf0e350e043f1e48ce62335299b601c1a45";
const BOUNDED_PARENT_COMMIT = "f3c0761e6fe5936e57f3544f3dde5df3799324f9";
const DEFAULT_EVENT_TYPE = "owner_publish_intake";
const DEFAULT_WORKFLOW_EVENT = "repository_dispatch";
const DEFAULT_WORKFLOW_FILE = "publish-owner-intake.yml";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const LEGACY_TIMEOUT_MS = 120000;
const BOUNDED_TIMEOUT_MS = 15000;
const DEFAULT_DELAY_SECONDS = 110;
const MAX_DELAY_SECONDS = 180;

export async function handlePublishProofRequest(request, env) {
  if (String(request.method || "GET").toUpperCase() !== "POST") {
    return jsonResponse({
      error: "Publish proof only accepts POST requests."
    }, 405);
  }

  const deploymentBranch = String(env.CF_PAGES_BRANCH || "").trim();
  if (!deploymentBranch || deploymentBranch === "main") {
    return jsonResponse({
      error: "Publish proof only runs on a non-production Pages preview deployment."
    }, 403);
  }

  const parsed = await parseRequest(request);
  if (!parsed.valid) {
    return jsonResponse({
      error: parsed.userMessage
    }, 400);
  }

  const correlationId = parsed.correlationId || `proof-${Date.now()}-${crypto.randomUUID()}`;
  const trace = [];
  const startMs = Date.now();
  const record = (event, details = {}) => {
    const entry = {
      branch: deploymentBranch,
      correlationId,
      event,
      isoTime: new Date().toISOString(),
      relativeMs: Date.now() - startMs,
      ...details
    };
    trace.push(entry);
    console.log(JSON.stringify({
      diagnostic: "publish-proof",
      ...entry
    }));
    return entry;
  };

  record("request_start", {
    line: 33,
    mode: parsed.mode,
    workflowDelaySeconds: parsed.workflowDelaySeconds
  });

  const workflowFile = DEFAULT_WORKFLOW_FILE;
  const publishId = `proof-${parsed.mode}-${Date.now()}-${crypto.randomUUID()}`;
  const payload = {
    correlation_id: correlationId,
    diagnostic_delay_seconds: parsed.workflowDelaySeconds,
    metadata: {
      slug: "diagnostic-noop"
    },
    operation: "diagnostic_noop",
    publish_id: publishId,
    ref: deploymentBranch,
    requested_by: "publish-proof"
  };

  try {
    const result = parsed.mode === "legacy"
      ? await runLegacyWaitProof(payload, env, workflowFile, record)
      : await runBoundedWaitProof(payload, env, workflowFile, record);

    record("response_attempt", {
      line: 72,
      ok: result.ok,
      pending: Boolean(result.pending),
      reason: result.reason || "",
      runId: result.runId || null
    });

    const status = result.ok
      ? (result.pending ? 202 : 200)
      : (result.reason === "workflow_timeout" ? 504 : 502);

    return jsonResponse({
      branch: deploymentBranch,
      correlationId,
      legacySourceCommit: LEGACY_PARENT_COMMIT,
      mode: parsed.mode,
      ok: result.ok,
      pending: Boolean(result.pending),
      publishId,
      reason: result.reason || "",
      responseStatus: status,
      runId: result.runId || null,
      runUrl: result.runUrl || "",
      trace,
      userMessage: result.userMessage || "",
      workflowDelaySeconds: parsed.workflowDelaySeconds,
      workflowFile
    }, status);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    record("exception", {
      errorMessage,
      errorName: error instanceof Error ? error.name : "UnknownError",
      line: 105
    });
    return jsonResponse({
      branch: deploymentBranch,
      correlationId,
      error: "Publish proof threw an unexpected exception.",
      errorMessage,
      mode: parsed.mode,
      publishId,
      trace,
      workflowDelaySeconds: parsed.workflowDelaySeconds,
      workflowFile
    }, 500);
  }
}

async function parseRequest(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return {
      valid: false,
      userMessage: "Publish proof expects a JSON request body."
    };
  }

  const mode = String(payload?.mode || "").trim().toLowerCase();
  if (mode !== "legacy" && mode !== "bounded") {
    return {
      valid: false,
      userMessage: "Mode must be either legacy or bounded."
    };
  }

  const requestedDelay = Number(payload?.workflowDelaySeconds);
  const workflowDelaySeconds = Number.isFinite(requestedDelay)
    ? Math.min(Math.max(Math.round(requestedDelay), 1), MAX_DELAY_SECONDS)
    : DEFAULT_DELAY_SECONDS;

  return {
    valid: true,
    correlationId: String(payload?.correlationId || "").trim(),
    mode,
    workflowDelaySeconds
  };
}

async function runLegacyWaitProof(payload, env, workflowFile, record) {
  const fetchImpl = fetch;
  const now = Date.now();
  const owner = String(env.GITHUB_REPO_OWNER || "");
  const repo = String(env.GITHUB_REPO_NAME || "");
  const token = String(env.GITHUB_TOKEN || "");

  if (!owner || !repo || !token) {
    return {
      ok: false,
      reason: "github_not_configured",
      userMessage: "GitHub publishing is not configured yet in this preview environment."
    };
  }

  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  record("dispatch_send", {
    line: 170,
    mode: "legacy",
    publishId: payload.publish_id
  });
  const dispatchResponse = await fetchImpl(dispatchUrl, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "TobaccoRoadGamesPublishProof/1.0"
    },
    body: JSON.stringify({
      client_payload: payload,
      event_type: DEFAULT_EVENT_TYPE
    })
  });
  if (!dispatchResponse.ok) {
    record("dispatch_rejected", {
      line: 184,
      status: dispatchResponse.status
    });
    return {
      ok: false,
      reason: "dispatch_failed",
      status: dispatchResponse.status,
      userMessage: await buildGithubErrorMessage(dispatchResponse, "GitHub refused to start the diagnostic workflow.")
    };
  }
  record("dispatch_accepted", {
    line: 193,
    status: dispatchResponse.status
  });

  const deadline = now + LEGACY_TIMEOUT_MS;
  let iteration = 0;
  while (Date.now() < deadline) {
    iteration += 1;
    record("poll_iteration", {
      iteration,
      line: 201,
      mode: "legacy",
      remainingMs: deadline - Date.now()
    });
    const run = await findMatchingWorkflowRun({
      createdAfterMs: now - 10000,
      fetchImpl,
      owner,
      payload,
      record,
      repo,
      token,
      workflowFile
    });

    if (!run) {
      record("workflow_run_missing", {
        iteration,
        line: 217
      });
      await sleep(DEFAULT_POLL_INTERVAL_MS);
      continue;
    }

    record("workflow_run_discovered", {
      iteration,
      line: 225,
      runCreatedAt: run.created_at || "",
      runId: run.id,
      runStatus: run.status || ""
    });

    if (run.status !== "completed") {
      await sleep(DEFAULT_POLL_INTERVAL_MS);
      continue;
    }

    record("workflow_completion_detected", {
      conclusion: run.conclusion || "",
      iteration,
      line: 237,
      runId: run.id
    });

    if (run.conclusion === "success") {
      return {
        ok: true,
        runId: run.id,
        runUrl: run.html_url,
        userMessage: "Legacy diagnostic wait observed a successful workflow completion."
      };
    }

    return {
      ok: false,
      reason: "workflow_failed",
      runId: run.id,
      runUrl: run.html_url,
      userMessage: "Legacy diagnostic wait observed a failed workflow run."
    };
  }

  record("workflow_timeout_reached", {
    line: 260,
    mode: "legacy"
  });
  return {
    ok: false,
    reason: "workflow_timeout",
    userMessage: "Legacy diagnostic wait reached the full synchronous timeout window."
  };
}

async function runBoundedWaitProof(payload, env, workflowFile, record) {
  const fetchImpl = fetch;
  const now = Date.now();
  const owner = String(env.GITHUB_REPO_OWNER || "");
  const repo = String(env.GITHUB_REPO_NAME || "");
  const token = String(env.GITHUB_TOKEN || "");

  if (!owner || !repo || !token) {
    return {
      ok: false,
      reason: "github_not_configured",
      userMessage: "GitHub publishing is not configured yet in this preview environment."
    };
  }

  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  record("dispatch_send", {
    line: 288,
    mode: "bounded",
    publishId: payload.publish_id
  });
  const dispatchResponse = await fetchImpl(dispatchUrl, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "TobaccoRoadGamesPublishProof/1.0"
    },
    body: JSON.stringify({
      client_payload: payload,
      event_type: DEFAULT_EVENT_TYPE
    })
  });
  if (!dispatchResponse.ok) {
    record("dispatch_rejected", {
      line: 302,
      status: dispatchResponse.status
    });
    return {
      ok: false,
      reason: "dispatch_failed",
      status: dispatchResponse.status,
      userMessage: await buildGithubErrorMessage(dispatchResponse, "GitHub refused to start the diagnostic workflow.")
    };
  }
  record("dispatch_accepted", {
    line: 311,
    status: dispatchResponse.status
  });

  const deadline = now + BOUNDED_TIMEOUT_MS;
  let iteration = 0;
  let matchedRun = null;
  while (Date.now() < deadline) {
    iteration += 1;
    record("poll_iteration", {
      iteration,
      line: 320,
      mode: "bounded",
      remainingMs: deadline - Date.now()
    });
    const run = await findMatchingWorkflowRun({
      createdAfterMs: now - 10000,
      fetchImpl,
      owner,
      payload,
      record,
      repo,
      token,
      workflowFile
    });

    if (!run) {
      record("workflow_run_missing", {
        iteration,
        line: 337
      });
      await sleep(DEFAULT_POLL_INTERVAL_MS);
      continue;
    }

    matchedRun = run;
    record("workflow_run_discovered", {
      iteration,
      line: 346,
      runCreatedAt: run.created_at || "",
      runId: run.id,
      runStatus: run.status || ""
    });

    if (run.status !== "completed") {
      await sleep(DEFAULT_POLL_INTERVAL_MS);
      continue;
    }

    record("workflow_completion_detected", {
      conclusion: run.conclusion || "",
      iteration,
      line: 358,
      runId: run.id
    });

    if (run.conclusion === "success") {
      return {
        ok: true,
        runId: run.id,
        runUrl: run.html_url,
        userMessage: "Bounded diagnostic wait observed a successful workflow completion."
      };
    }

    return {
      ok: false,
      reason: "workflow_failed",
      runId: run.id,
      runUrl: run.html_url,
      userMessage: "Bounded diagnostic wait observed a failed workflow run."
    };
  }

  record("bounded_wait_returning_pending", {
    line: 380,
    mode: "bounded",
    runId: matchedRun?.id || null
  });
  return {
    ok: true,
    pending: true,
    reason: "workflow_pending",
    runId: matchedRun?.id,
    runUrl: matchedRun?.html_url || "",
    userMessage: "Bounded diagnostic wait is returning before workflow completion."
  };
}

async function findMatchingWorkflowRun(options) {
  const listUrl = new URL(`https://api.github.com/repos/${options.owner}/${options.repo}/actions/workflows/${options.workflowFile}/runs`);
  listUrl.searchParams.set("event", DEFAULT_WORKFLOW_EVENT);
  listUrl.searchParams.set("per_page", "20");

  options.record("workflow_list_request", {
    line: 397,
    url: listUrl.toString()
  });

  const response = await options.fetchImpl(listUrl.toString(), {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${options.token}`,
      "user-agent": "TobaccoRoadGamesPublishProof/1.0"
    }
  });

  options.record("workflow_list_response", {
    line: 408,
    status: response.status
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
  const expectedTitle = `Owner publish ${options.payload.publish_id}`;

  return runs.find((run) => {
    const createdAt = Date.parse(run.created_at || "");
    const displayTitle = String(run.display_title || run.name || "");
    return createdAt >= options.createdAfterMs && displayTitle === expectedTitle;
  }) || null;
}

async function buildGithubErrorMessage(response, fallback) {
  try {
    const payload = await response.json();
    const message = payload?.message ? String(payload.message) : "";
    if (message) {
      return `${fallback} ${message}`;
    }
  } catch {
    // Fall back to the generic message.
  }

  return fallback;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
