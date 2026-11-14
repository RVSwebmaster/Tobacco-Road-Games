(() => {
  const status = document.querySelector("#creator-status");
  const identity = document.querySelector("#creator-identity");

  async function loadCreatorSession() {
    try {
      const account = await fetch("/api/account/me", { credentials: "same-origin" }).then((response) => response.json());
      if (!account?.authenticated) {
        status.textContent = "Sign in to access your Creator identity.";
        return;
      }
      const response = await fetch("/api/creator/identity-options", { credentials: "same-origin" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.creators?.length) {
        status.textContent = "No authorized Creator identity is available.";
        return;
      }
      identity.textContent = `Signed in as ${payload.creators[0].displayName}.`;
      status.textContent = "Creator session active.";
    } catch {
      status.textContent = "Creator session status is unavailable.";
    }
  }

  loadCreatorSession();
})();
