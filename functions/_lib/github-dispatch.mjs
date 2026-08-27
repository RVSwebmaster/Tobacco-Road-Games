const DEFAULT_EVENT_TYPE = "owner_publish_intake";
const DEFAULT_WORKFLOW_EVENT = "repository_dispatch";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_COMPLETION_WAIT_MS = 15000;
const DEFAULT_WORKFLOW_FILE = "publish-owner-intake.yml";

export async function dispatchPublishWorkflow(payload, env, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = Date.now();
  const owner = String(env.GITHUB_REPO_OWNER || "");
  const repo = String(env.GITHUB_REPO_NAME || "");
  const token = String(env.GITHUB_TOKEN || "");
  const workflowFile = String(env.GITHUB_PUBLISH_WORKFLOW_FILE || DEFAULT_WORKFLOW_FILE);
  const completionWaitMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_COMPLETION_WAIT_MS;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs : DEFAULT_POLL_INTERVAL_MS;

  if (!owner || !repo || !token) {
    return {
      ok: false,
      reason: "github_not_configured",
      userMessage: "GitHub publishing is not configured yet. Add the repository owner, repository name, and token secrets in Cloudflare first."
    };
  }

  const dispatchUrl = `https://api.github.com/repos/${owner}/${repo}/dispatches`;
  let dispatchResponse;
  try {
    dispatchResponse = await fetchImpl(dispatchUrl, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "TobaccoRoadGamesOwnerPublish/1.0"
      },
      body: JSON.stringify({
        client_payload: payload,
        event_type: DEFAULT_EVENT_TYPE
      })
    });
  } catch {
    return {
      ok: false,
      reason: "dispatch_request_failed",
      userMessage: "GitHub publishing could not be reached from Cloudflare. Check outbound connectivity and GitHub configuration, then try again."
    };
  }

  if (!dispatchResponse.ok) {
    return {
      ok: false,
      reason: "dispatch_failed",
      status: dispatchResponse.status,
      userMessage: await buildGithubErrorMessage(dispatchResponse, "GitHub accepted the upload request, but it refused to start the publish workflow.")
    };
  }

  const deadline = now + completionWaitMs;
  let matchedRun = null;
  while (Date.now() < deadline) {
    const run = await findMatchingWorkflowRun({
      createdAfterMs: now - 10000,
      fetchImpl,
      owner,
      payload,
      repo,
      token,
      workflowFile
    });

    if (!run) {
      await sleep(pollIntervalMs);
      continue;
    }

    matchedRun = run;

    if (run.status !== "completed") {
      await sleep(pollIntervalMs);
      continue;
    }

    if (run.conclusion === "success") {
      return {
        ok: true,
        runId: run.id,
        runUrl: run.html_url,
        userMessage: "The files uploaded and the GitHub publish workflow finished successfully."
      };
    }

    return {
      ok: false,
      reason: "workflow_failed",
      runId: run.id,
      runUrl: run.html_url,
      userMessage: "The files uploaded to R2, but the GitHub publish workflow failed before the store finished publishing."
    };
  }

  return {
    ok: true,
    pending: true,
    reason: "workflow_pending",
    runId: matchedRun?.id,
    runUrl: matchedRun?.html_url || "",
    userMessage: "GitHub accepted the publish request and the store rebuild is still running. Check the workflow link and refresh the live site in about a minute."
  };
}

async function findMatchingWorkflowRun(options) {
  const listUrl = new URL(`https://api.github.com/repos/${options.owner}/${options.repo}/actions/workflows/${options.workflowFile}/runs`);
  listUrl.searchParams.set("event", DEFAULT_WORKFLOW_EVENT);
  listUrl.searchParams.set("per_page", "20");

  let response;
  try {
    response = await options.fetchImpl(listUrl.toString(), {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${options.token}`,
        "user-agent": "TobaccoRoadGamesOwnerPublish/1.0"
      }
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
  const expectedTitle = `Owner publish ${options.payload.publish_id}`;

  return runs.find((run) => {
    const createdAt = Date.parse(run.created_at || "");
    const displayTitle = String(run.display_title || run.name || "");
    return Number.isFinite(createdAt) && displayTitle === expectedTitle;
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
    // Ignore parse failures and fall back to a plain message.
  }

  return fallback;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
