(() => {
  const status = document.querySelector("#creator-status");
  const identity = document.querySelector("#creator-identity");
  const creatorImage = identity?.querySelector(".creator-dashboard-creator-image");
  const creatorInitials = identity?.querySelector(".creator-dashboard-creator-initials");
  const creatorName = identity?.querySelector(".creator-dashboard-creator-name");

  function initialsFor(displayName) {
    const words = String(displayName || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
  }

  function showInitials(displayName) {
    creatorImage.hidden = true;
    creatorImage.removeAttribute("src");
    creatorInitials.textContent = initialsFor(displayName);
    creatorInitials.setAttribute("aria-label", `${initialsFor(displayName)} initials`);
    creatorInitials.removeAttribute("hidden");
    creatorInitials.style.display = "grid";
    creatorInitials.setAttribute("aria-hidden", "false");
  }

  function imageIsUsable(image) {
    if (!image.naturalWidth || !image.naturalHeight) return false;
    const ratio = image.naturalWidth / image.naturalHeight;
    return ratio >= 0.55 && ratio <= 2.25;
  }

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
        payload.creators.find((creator) => creator.slug === requested) ||
        payload.creators.find((creator) => creator.id === stored) ||
        payload.creators[0];
      const displayName = selected.displayName || "Creator";
      const preferInitials = displayName.trim().toLowerCase() === "rv sawyer";
      creatorName.textContent = displayName;
      showInitials(displayName);
      identity.hidden = false;
      status.textContent = "Creator session active.";

      if (preferInitials) return;

      const profileResponse = await fetch(
        `/api/creator/profile?creator=${encodeURIComponent(selected.id || selected.slug)}`,
        { credentials: "same-origin" },
      );
      const profilePayload = await profileResponse.json().catch(() => ({}));
      if (!profileResponse.ok || !profilePayload.creator) return;
      const creator = profilePayload.creator;
      const imageUrl = creator.logo || creator.profileImage || "";
      creatorInitials.hidden = true;
      creatorInitials.style.display = "none";
      if (imageUrl) {
        creatorImage.onload = () => {
          if (!imageIsUsable(creatorImage)) showInitials(creator.displayName);
        };
        creatorImage.onerror = () => showInitials(creator.displayName);
        creatorImage.hidden = false;
        creatorImage.src = imageUrl;
        creatorImage.alt = `${creator.displayName} publishing identity`;
      } else showInitials(creator.displayName);
    } catch {
      status.textContent = "Creator session status is unavailable.";
    }
  }

  loadCreatorSession();
})();
