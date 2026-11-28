(() => {
  const status = document.querySelector("[data-member-profile-status]");
  const profilePage = document.querySelector("[data-member-profile-page]");
  const profileHeading = document.querySelector("[data-member-profile-heading]");
  const tierBadge = document.querySelector("[data-member-tier-badge]");
  const tierBadgeFiles = new Map([
    ["customer", "customer.png"],
    ["creator", "creator.png"],
    ["founding25", "founding-25.png"],
    ["premiumCreator", "premium-creator.png"],
    ["admin", "admin.png"],
    ["owner", "owner.png"],
  ]);
  const memberDashboardLink = document.querySelector("[data-member-dashboard-link]");
  const defaultTitle = document.title;

  function initialsFor(displayName) {
    const words = String(displayName || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    if (words[0].length >= 2) return words[0].slice(0, 2).toUpperCase();
    return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
  }

  function buildMetalInitials(initials) {
    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    const defs = document.createElementNS(svgNamespace, "defs");
    const gradient = document.createElementNS(svgNamespace, "linearGradient");
    const text = document.createElementNS(svgNamespace, "text");
    const gradientId = `member-metal-${Math.random().toString(36).slice(2)}`;

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

  function mount(board) {
    const image = board.querySelector("[data-member-identity-image]");
    const initials = board.querySelector("[data-member-identity-initials]");
    const name = board.querySelector("[data-member-identity-name]");
    if (!image || !initials || !name) return;
    let requestId = 0;

    function clear() {
      board.hidden = true;
      image.hidden = true;
      image.removeAttribute("src");
      image.alt = "";
      initials.replaceChildren();
      initials.hidden = true;
      initials.style.display = "none";
      initials.setAttribute("aria-hidden", "true");
      name.textContent = "";
      if (tierBadge) {
        tierBadge.hidden = true;
        tierBadge.removeAttribute("src");
        tierBadge.alt = "";
      }
      if (profilePage) {
        document.title = defaultTitle;
        if (profileHeading) profileHeading.textContent = "Member Profile";
      }
      if (memberDashboardLink) memberDashboardLink.hidden = true;
    }

    function showInitials(displayName) {
      const value = initialsFor(displayName);
      if (!value) return clear();
      image.hidden = true;
      image.removeAttribute("src");
      image.alt = "";
      initials.replaceChildren(buildMetalInitials(value));
      initials.setAttribute("aria-label", `${value} initials`);
      initials.hidden = false;
      initials.style.display = "grid";
      initials.setAttribute("aria-hidden", "false");
    }

    async function loadMemberIdentity() {
      const currentRequest = ++requestId;
      clear();
      try {
        const response = await fetch("/api/account/me", {
          credentials: "same-origin",
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (currentRequest !== requestId) return;
        const account = response.ok ? await response.json() : null;
        if (!account?.authenticated || !account.user) {
          if (status) status.textContent = "Sign in to show your member identity.";
          return;
        }
        if (currentRequest !== requestId) return;
        const member = account.user;
        const accountClass = String(member.accountClass || "");
        const accountClassLabel = String(member.accountClassLabel || "Member");
        const badgeFile = tierBadgeFiles.get(accountClass);
        if (tierBadge && badgeFile) {
          tierBadge.src = `/assets/images/member-tier-badges/${badgeFile}`;
          tierBadge.alt = `${accountClassLabel} tier badge`;
          tierBadge.hidden = false;
        }
        const displayName = String(member?.displayName || "").trim();
        if (!displayName) {
          if (status) status.textContent = "A public display name is not available.";
          return;
        }

        name.textContent = displayName;
        board.setAttribute("aria-label", `${accountClassLabel} identity`);
        if (profilePage) {
          document.title = `${accountClassLabel} Profile | Tobacco Road Games`;
        if (profileHeading) profileHeading.textContent = `${accountClassLabel} Profile`;
        if (profilePage.hasAttribute("data-member-dashboard-page")) {
          document.title = `${accountClassLabel} Dashboard | Tobacco Road Games`;
          if (profileHeading) profileHeading.textContent = `${accountClassLabel} Dashboard`;
        }
        }
        if (memberDashboardLink) {
          memberDashboardLink.hidden = !["customer", "creator", "premiumCreator", "founding25", "owner"].includes(accountClass);
          if (accountClass === "owner") memberDashboardLink.hidden = false;
        }
        board.hidden = false;
        const imageUrl = String(member.avatarUrl || "").trim();
        if (!imageUrl) {
          showInitials(displayName);
          if (status) status.textContent = "Member identity loaded.";
          return;
        }

        image.onload = () => {
          if (currentRequest !== requestId) return;
          if (!imageIsUsable(image)) showInitials(displayName);
          else {
            initials.replaceChildren();
            initials.hidden = true;
            initials.style.display = "none";
            initials.setAttribute("aria-hidden", "true");
            image.alt = `${displayName} profile image`;
            image.hidden = false;
          }
        };
        image.onerror = () => {
          if (currentRequest === requestId) showInitials(displayName);
        };
        image.src = imageUrl;
        if (status) status.textContent = "Member identity loaded.";
      } catch {
        if (currentRequest !== requestId) return;
        clear();
        if (status) status.textContent = "Member identity is unavailable.";
      }
    }

    window.addEventListener("focus", loadMemberIdentity);
    window.addEventListener("pageshow", loadMemberIdentity);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadMemberIdentity();
    });
    loadMemberIdentity();
  }

  document.querySelectorAll("[data-member-identity-board]").forEach(mount);
})();
