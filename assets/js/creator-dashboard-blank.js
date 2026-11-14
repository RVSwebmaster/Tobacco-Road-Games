(() => {
  const status = document.querySelector("#creator-status");
  const identity = document.querySelector("#creator-identity");
  let creatorImage = identity?.querySelector(".creator-dashboard-creator-image");
  let creatorInitials = identity?.querySelector(".creator-dashboard-creator-initials");
  const creatorName = identity?.querySelector(".creator-dashboard-creator-name");

  if (identity && !creatorInitials) {
    creatorInitials = document.createElement("span");
    creatorInitials.className = "creator-dashboard-creator-initials";
    creatorInitials.hidden = true;
    creatorInitials.setAttribute("aria-hidden", "true");
    identity.insertBefore(creatorInitials, creatorName || null);
  }

  function initialsFor(displayName) {
    const words = String(displayName || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
  }

  function showInitials(displayName) {
    if (creatorImage) {
      creatorImage.hidden = true;
      creatorImage.removeAttribute("src");
    }
    if (!creatorInitials) return;
    const initials = initialsFor(displayName);
    creatorInitials.replaceChildren(buildMetalInitials(initials));
    creatorInitials.setAttribute("aria-label", `${initials} initials`);
    creatorInitials.removeAttribute("hidden");
    creatorInitials.style.display = "grid";
    creatorInitials.setAttribute("aria-hidden", "false");
  }

  function buildMetalInitials(initials) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    const defs = document.createElementNS(svgNamespace, "defs");
    const gradient = document.createElementNS(svgNamespace, "linearGradient");
    const text = document.createElementNS(svgNamespace, "text");
    const gradientId = `creator-metal-${Math.random().toString(36).slice(2)}`;

    svg.setAttribute("class", "creator-dashboard-creator-initials-svg");
    svg.setAttribute("viewBox", "0 0 220 140");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", initials);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    gradient.setAttribute("id", gradientId);
    gradient.setAttribute("x1", "0");
    gradient.setAttribute("y1", "0");
    gradient.setAttribute("x2", "0");
    gradient.setAttribute("y2", "1");
    [
      ["0%", "#fff7c7"], ["3%", "#f6c24f"], ["15%", "#cf7b0d"],
      ["28%", "#7b3002"], ["43%", "#351003"], ["50%", "#241006"],
      ["58%", "#9e4b04"], ["70%", "#f0b63b"], ["80%", "#7a2f02"],
      ["87%", "#321003"], ["95%", "#c46b0a"], ["100%", "#fff1ac"],
    ].forEach(([offset, color]) => {
      const stop = document.createElementNS(svgNamespace, "stop");
      stop.setAttribute("offset", offset);
      stop.setAttribute("stop-color", color);
      gradient.append(stop);
    });
    text.setAttribute("x", "110");
    text.setAttribute("y", "111");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-family", "Georgia, Times New Roman, serif");
    text.setAttribute("font-size", "136");
    text.setAttribute("font-weight", "900");
    text.setAttribute("fill", `url(#${gradientId})`);
    text.setAttribute("stroke", "#d38b1c");
    text.setAttribute("stroke-width", "1.5");
    text.setAttribute("paint-order", "stroke fill");
    text.textContent = initials;
    defs.append(gradient);
    svg.append(defs, text);
    return svg;
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
      if (creatorInitials) {
        creatorInitials.hidden = true;
        creatorInitials.style.display = "none";
      }
      if (imageUrl) {
        if (!creatorImage) return;
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
