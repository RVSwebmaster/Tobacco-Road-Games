(() => {
  const status = document.querySelector("#creator-status");
  const identity = document.querySelector("#creator-identity");
  const creatorImage = identity?.querySelector(".creator-dashboard-creator-image");
  const creatorName = identity?.querySelector(".creator-dashboard-creator-name");

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
      const requested = new URL(location.href).searchParams.get("creator") || "";
      let stored = "";
      try {
        stored = localStorage.getItem("trg_current_creator_identity") || "";
      } catch {}
      const selected =
        payload.creators.find((creator) => creator.id === requested) ||
        payload.creators.find((creator) => creator.id === stored) ||
        payload.creators[0];
      const profileResponse = await fetch(
        `/api/creator/profile?creator=${encodeURIComponent(selected.id)}`,
        { credentials: "same-origin" },
      );
      const profilePayload = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok || !profilePayload.creator) {
        status.textContent = "Creator profile is unavailable.";
        return;
      }
      const creator = profilePayload.creator;
      const imageUrl = creator.logo || creator.profileImage || "";
      if (imageUrl) {
        creatorImage.src = imageUrl;
        creatorImage.alt = `${creator.displayName} publishing identity`;
        creatorImage.hidden = false;
      } else {
        creatorImage.hidden = true;
      }
      creatorName.textContent = creator.displayName;
      identity.hidden = false;
      status.textContent = "Creator session active.";
    } catch {
      status.textContent = "Creator session status is unavailable.";
    }
  }

  loadCreatorSession();
})();
