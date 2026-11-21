(() => {
  const rows = Array.from(document.querySelectorAll("[data-member-library-books]"));
  if (!rows.length) return;

  let memberId = "";
  let requestId = 0;

  function clearShelves() {
    rows.forEach((row) => row.replaceChildren());
    document.dispatchEvent(new CustomEvent("trg:member-library-updated"));
  }

  async function refreshAccount() {
    const currentRequest = ++requestId;
    try {
      const response = await fetch("/api/account/me", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        cache: "no-store"
      });
      if (currentRequest !== requestId) return;
      const account = response.ok ? await response.json() : null;
      const nextMemberId = account?.authenticated === true
        ? String(account.user?.id || "").trim()
        : "";

      if (!nextMemberId) {
        if (memberId || rows.some((row) => row.childNodes?.length)) clearShelves();
        memberId = "";
        return;
      }

      if (memberId && memberId !== nextMemberId) clearShelves();
      memberId = nextMemberId;
    } catch {
      if (currentRequest !== requestId) return;
      if (memberId || rows.some((row) => row.childNodes?.length)) clearShelves();
      memberId = "";
    }
  }

  window.addEventListener("focus", refreshAccount);
  window.addEventListener("pageshow", refreshAccount);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAccount();
  });
  document.addEventListener("trg:account-changed", refreshAccount);
  refreshAccount();
})();
