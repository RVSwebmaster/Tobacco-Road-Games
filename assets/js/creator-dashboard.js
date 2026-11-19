(() => {
  const status = document.querySelector("#creator-status"),
    overview = document.querySelector("#creator-overview"),
    listingsPanel = document.querySelector("#creator-listings"),
    profilePanel = document.querySelector("#creator-profile"),
    creatorPdfInput = document.querySelector("#creator-pdf-file"),
    creatorPdfReview = document.querySelector("#creator-pdf-review"),
    creatorPdfStatus = document.querySelector("#creator-pdf-status");
  let csrf = "";
  let currentCreatorId = "";
  let ownerAdjustmentKey = "";
  let ownerFinancialSnapshot = null;
  let creatorPdf = null;
  let creatorPdfRun = 0;
  let creatorPdfFrontUrl = "";
  let creatorPdfBackUrl = "";
  let pendingPdfDraftId = "";
  let pendingPdfDraftRevision = 1;
  function creatorApiUrl(path) {
    const url = new URL(`/api/creator/${path}`, location.origin);
    if (currentCreatorId) url.searchParams.set("creator", currentCreatorId);
    return `${url.pathname}${url.search}`;
  }
  async function api(path, body) {
    if (
      body &&
      /listings\/[^/]+\/submit$/.test(path) &&
      body.rightsConfirmed !== true
    ) {
      if (
        !confirm(
          "Confirm that you have sufficient rights to sell this material, the listing accurately represents what the customer receives, and required third-party licenses and attributions are your responsibility.",
        )
      )
        throw new Error("Submission declarations were not accepted.");
      body = {
        ...body,
        rightsConfirmed: true,
        representationConfirmed: true,
        licensesConfirmed: true,
      };
    }
    const response = await fetch(creatorApiUrl(path), {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: body
        ? { "content-type": "application/json", "x-csrf-token": csrf }
        : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(
        payload?.error?.message || payload?.error || "Creator tools are unavailable.",
      );
    return payload;
  }
  async function load() {
    const account = await fetch("/api/account/me", {
      credentials: "same-origin",
    }).then((r) => r.json());
    csrf = account.csrfToken || "";
    const identityOptions = await api("identity-options"),
      identities = identityOptions.creators || [],
      requested = new URL(location.href).searchParams.get("creator") || "",
      stored = readSelectedCreator();
    currentCreatorId =
      identities.find((creator) => creator.id === requested)?.id ||
      identities.find((creator) => creator.id === stored)?.id ||
      identities[0]?.id ||
      "";
    if (!currentCreatorId)
      throw new Error("No authorized Creator identity is available.");
    renderCreatorSelector(identities);
    const summary = await api("overview"),
      [profileData, finance, operations, preferred, closure] =
      await Promise.all([
        api("profile"),
        api("finance"),
        api("operations"),
        api("preferred"),
        api("closure"),
      ]);
    document.querySelector("#creator-name").textContent =
      summary.creator.displayName;
    status.textContent = summary.ownerOperationalAuthority
      ? `Profile ${summary.overview.profileStatus}. Owner access is active for the linked Creator identity; commercial requirements still apply to sales and payouts.`
      : summary.intakeAccess
      ? `Profile ${summary.overview.profileStatus}. Current Creator eligibility confirmed.`
      : summary.historicalRegistration?.completed
        ? "Your Creator identity and history are preserved, but current eligibility needs attention before protected operations can resume."
        : "Complete every registration and payout-onboarding requirement to unlock product intake and listing tools.";
    document.querySelector("#creator-metrics").hidden = !summary.intakeAccess;
    document.querySelector("#creator-metrics").textContent =
      `${summary.overview.activeListings} active · ${summary.overview.draftListings} drafts · ${summary.overview.unavailableListings} unavailable · ${summary.overview.recentOrderCount} paid orders`;
    renderRegistrationReadiness(summary);
    const money = (value) => `$${(Number(value || 0) / 100).toFixed(2)}`;
    document.querySelector("#creator-finance-summary").textContent =
      `Gross ${money(finance.summary.grossSalesCents)} · marketplace fees ${money(finance.summary.marketplaceFeesCents)} · lifetime net earnings ${money(finance.summary.lifetimeEarningsCents)} · refunds/adjustments ${money(finance.summary.refundsAndAdjustmentsCents)} · Creator Balance available ${money(finance.creatorBalance.availableCents)} · pending ${money(finance.creatorBalance.pendingCents)} · held ${money(finance.creatorBalance.heldCents)} · payout reserved ${money(finance.creatorBalance.payoutReservedCents)} · purchase reserved ${money(finance.creatorBalance.purchaseReservedCents)} · paid ${money(finance.summary.paidBalanceCents)}`;
    renderOwnerFinancials(finance.ownerFinancials, finance.payout, money);
    const payoutInput = document.querySelector(
      '#creator-payout-request-form input[name="amount"]',
    );
    payoutInput.max = String(finance.payout.maximumOrdinaryPayoutCents / 100);
    payoutInput.disabled = finance.payout.maximumOrdinaryPayoutCents < 1000;
    document.querySelector("#creator-payout-status").textContent = finance
      .payout.eligible
      ? `Payout ready: up to ${money(finance.payout.maximumOrdinaryPayoutCents)} in $10 increments. ${money(finance.payout.ordinaryPayoutRemainderCents)} remains in Creator Balance.`
      : `Payout blocked: ${finance.payout.blockedReasons.join(" ")}`;
    document.querySelector("#creator-connect-dashboard").hidden =
      finance.payout.profile?.provider !== "stripe_connect" ||
      !finance.payout.profile?.provider_account_reference;
    document.querySelector("#creator-payment-method-status").textContent =
      summary.registrationChecks?.paymentMethodReady
        ? "Payment method — Complete"
        : "Payment method — Needs attention. Stripe-hosted collection is not available yet.";
    document.querySelector("#creator-preferred").hidden = false;
    const preferredBilling = preferred.billing || {},
      commitment = preferredBilling.commitment,
      currentInstallment = preferredBilling.currentInstallment;
    document.querySelector("#creator-preferred-summary").textContent = commitment
      ? `${preferredBilling.active ? "Preferred active" : "Preferred billing needs attention"} · ${commitment.plan_type === "monthly_commitment" ? `installment ${Math.min((preferredBilling.paidCount || 0) + 1, 12)} of 12${currentInstallment ? ` · next $20 due ${formatDate(currentInstallment.due_at)}` : ""}` : "annual prepaid"} · paid through ${commitment.paid_through_at ? formatDate(commitment.paid_through_at) : "payment pending"} · billing ${commitment.billing_state} · renewal ${commitment.renewal_state.replaceAll("_", " ")} · Creator Balance ${money(preferred.balance.availableCents)} available. Creator Balance is never spent automatically.`
      : `Standard tier · Creator Balance ${money(preferred.balance.availableCents)} available. Choose a 12-month monthly commitment or annual prepaid coverage.`;
    const balancePrivilege = preferred.internalPurchase || {},
      currentPreferred = Boolean(balancePrivilege.preferred);
    document.querySelector("#creator-preferred-monthly-stripe").hidden = currentPreferred || Boolean(commitment);
    document.querySelector("#creator-preferred-annual-stripe").hidden = currentPreferred || Boolean(commitment);
    document.querySelector("#creator-preferred-do-not-renew").hidden =
      !commitment || commitment.renewal_state === "do_not_renew";
    for (const button of document.querySelectorAll("[data-preferred-balance-plan]")) {
      const annual = button.dataset.preferredBalancePlan === "annual_prepaid",
        eligible = annual ? balancePrivilege.annualRenewalEligible : balancePrivilege.monthlyEligible,
        required = annual ? preferred.pricing.annualPrepaidCents : preferred.pricing.monthlyCommitmentCents;
      button.hidden = !eligible;
      button.disabled = !eligible || preferred.balance.availableCents < required;
    }
    document.querySelector("#creator-preferred-balance-guidance").textContent = currentPreferred
      ? `Creator Balance: ${money(preferred.balance.availableCents)}. Eligible charges require full coverage; external payment is required when Balance is insufficient. Balance and card payment cannot be combined.`
      : "Initial Preferred activation requires external payment.";
    renderOperations(operations);
    renderClosure(closure, money);
    fillProfile(profileData.creator);
    overview.hidden =
      profilePanel.hidden =
      document.querySelector("#creator-finance").hidden =
        false;
    document.querySelector("#creator-business-records").hidden = false;
    const [listingData, analytics] = await Promise.all([
      api("listings"),
      api("analytics"),
    ]);
    renderCreatorAnalytics(analytics.analytics);
    document.querySelector("#creator-analytics-card").hidden = false;
    renderListings(listingData.listings, listingData.files || []);
    listingsPanel.hidden = false;
    document.querySelector("#creator-draft-form").hidden =
      document.querySelector("#creator-file-form").hidden =
        !summary.intakeAccess;
    document.querySelector("#creator-payout-request-form").hidden =
      !summary.intakeAccess;
    for (const button of document.querySelectorAll(
      "[data-preferred-balance-plan]",
    ))
      button.disabled = button.disabled || !summary.intakeAccess;
    if (!summary.intakeAccess) return;
    const advertising = await api("advertising");
    renderAdvertising(advertising);
    for (const select of document.querySelectorAll('select[name="listingId"]'))
      select.replaceChildren(
        ...listingData.listings.map((item) => new Option(item.title, item.id)),
      );
    document.querySelector("#creator-advertising").hidden = false;
    return listingData;
  }
  function readSelectedCreator() {
    try {
      return localStorage.getItem("trg_current_creator_identity") || "";
    } catch {
      return "";
    }
  }
  function rememberSelectedCreator(creatorId) {
    try {
      localStorage.setItem("trg_current_creator_identity", creatorId);
    } catch {}
  }
  function renderCreatorSelector(identities) {
    const control = document.querySelector("#creator-identity-control"),
      selector = document.querySelector("#creator-identity-selector");
    selector.replaceChildren(
      ...identities.map((creator) => {
        const option = document.createElement("option");
        option.value = creator.id;
        option.textContent = creator.displayName;
        option.selected = creator.id === currentCreatorId;
        return option;
      }),
    );
    control.hidden = identities.length < 2;
    rememberSelectedCreator(currentCreatorId);
  }
  document
    .querySelector("#creator-identity-selector")
    .addEventListener("change", (event) => {
      const creatorId = event.currentTarget.value;
      rememberSelectedCreator(creatorId);
      const url = new URL(location.href);
      url.searchParams.set("creator", creatorId);
      location.assign(url.toString());
    });
  function renderClosure(closure, money) {
    const panel = document.querySelector("#creator-closure");
    panel.hidden = false;
    const labels = { active: "Creator account is active.", closing: "Closure requested. Listings are closed to new sales.", closed: "Creator account closed." };
    document.querySelector("#creator-closure-status").textContent = labels[closure.state] || closure.state;
    document.querySelector("#creator-closure-blockers").replaceChildren(...(closure.blockers || []).map((x) => { const p=document.createElement("p"); p.textContent=`${x.message}${x.amountCents ? ` ${money(x.amountCents)}` : ""}`; return p; }));
    document.querySelector("#creator-closure-form").hidden = closure.state !== "active";
  }
  function renderOwnerFinancials(data, payout, money) {
    const panel = document.querySelector("#owner-financial-controls");
    if (!data) return;
    ownerFinancialSnapshot = data;
    panel.hidden = false;
    document.querySelector("#owner-financial-summary").textContent =
      `Creator funds ${money(data.liability.currentNetLiabilityCents)} · available ${money(data.liability.availableBalanceCents)} · pending ${money(data.liability.pendingBalanceCents)} · held ${money(data.liability.heldBalanceCents)} · dispute-held ${money(data.liability.disputeHeldCents)} · payout reserved ${money(data.liability.payoutReservedCents)} · purchase reserved ${money(data.liability.purchaseReservedCents)} · payout eligible ${money(data.liability.payoutEligibleCents)} · retained ordinary-payout remainder ${money(payout.ordinaryPayoutRemainderCents)}. Tobacco Road Games earned ${money(data.revenue.netRetainedRevenueCents)}: product commissions ${money(data.revenue.productCommission.netCents)}, Preferred ${money(data.revenue.serviceRevenue.preferredStripeNetCents + data.revenue.serviceRevenue.preferredCreatorBalanceNetCents)}, additional identities ${money(data.revenue.serviceRevenue.additionalIdentityStripeNetCents + data.revenue.serviceRevenue.additionalIdentityCreatorBalanceNetCents)}, Ad Credits ${money(data.revenue.serviceRevenue.adCreditsStripeNetCents + data.revenue.serviceRevenue.adCreditsCreatorBalanceNetCents)}, all services ${money(data.revenue.serviceRevenue.netCents)}, reversals ${money(data.revenue.productCommission.reversalsCents + data.revenue.serviceRevenue.reversalsCents)}, provider/processor costs ${money(data.revenue.costs.totalCents)}, owner adjustments ${money(data.revenue.ownerRevenueAdjustmentsCents)}.`;
    const history = [...data.creatorAdjustments.map((x) => ({ ...x, account: "Creator funds" })), ...data.revenueAdjustments.map((x) => ({ ...x, account: "Tobacco Road Games earned" }))].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));
    document.querySelector("#owner-financial-history").replaceChildren(...history.map((x) => {
      const p = document.createElement("p");
      p.textContent = `${x.created_at} · ${x.account}: ${money(x.previous_total_cents)} → ${money(x.new_total_cents)} (${money(x.delta_cents)}) · ${x.reason} · ${x.actor_display}`;
      return p;
    }), ...data.payoutHistory.map((x) => { const p=document.createElement("p"); p.textContent=`${x.paid_at} · Creator payout ${money(x.amount_cents)} · ${x.status} · ${x.reference}`; return p; }));
  }
  function renderCreatorAnalytics(analytics) {
    const root = document.querySelector("#creator-analytics");
    root.replaceChildren();
    const sales = document.createElement("p");
    sales.textContent = `${analytics.unitsSold} units · $${(analytics.grossCents / 100).toFixed(2)} gross sales`;
    root.append(sales);
    if (!analytics.reputation) return;
    const reputation = analytics.reputation,
      heading = document.createElement("h3");
    heading.textContent = "Creator reputation";
    const summary = document.createElement("p");
    summary.textContent = reputation.privateCount
      ? `${reputation.privateAverage.toFixed(1)} out of 5 · ${reputation.privateCount} verified rating${reputation.privateCount === 1 ? "" : "s"} · trend ${String(reputation.recentTrend).replace("_", " ")}`
      : "No verified Creator ratings yet.";
    root.append(heading, summary);
    const list = document.createElement("ul");
    list.className = "creator-rating-distribution";
    list.setAttribute("aria-label", "Creator rating distribution");
    for (let star = 5; star >= 1; star--) {
      const item = document.createElement("li");
      item.textContent = `${star} star${star === 1 ? "" : "s"}: ${reputation.distribution[star] || 0}`;
      list.append(item);
    }
    root.append(list);
  }
  function renderOperations(data) {
    const panel = document.querySelector("#creator-remediations"),
      root = document.querySelector("#creator-remediation-list");
    panel.hidden = false;
    root.replaceChildren(
      ...(data.remediations || []).map((item) => {
        const card = document.createElement("article"),
          title = document.createElement("h3"),
          details = document.createElement("p");
        card.className = "product-card__body";
        title.textContent = item.title;
        details.textContent = `${item.status} · opened ${item.opened_at} · deadline ${item.repair_due_at} · ${item.required_correction || "Correction details are in the operator notice."} · compliance ${item.compliance_result} · ${item.waiting_count} waiting · ${item.refund_required_count} refund-required`;
        card.append(title, details);
        if (item.status === "repair_open") {
          const form = document.createElement("form");
          form.className = "account-form";
          form.innerHTML =
            '<label>Approved private replacement object key <input name="objectKey" required maxlength="500"></label><button class="button button--secondary">Submit correction for compliance review</button>';
          form.onsubmit = async (event) => {
            event.preventDefault();
            await api(`remediations/${item.id}/submit`, {
              objectKey: form.elements.objectKey.value,
            });
            await load();
          };
          card.append(form);
        }
        return card;
      }),
    );
  }
  function renderRegistrationReadiness(summary) {
    const labels = {
        customerAccountComplete: "Customer Account",
        creatorPublicComplete: "Creator Identity",
        creatorDetailsComplete: "Business Information",
        agreementCurrent: "Creator Agreement",
        paymentMethodReady: "Payment Method",
        payoutReady: "Payout Setup",
        identityEntitled: "Creator Account",
        creatorAccountOperational: "Creator Account Standing",
        auditOperational: "Operational Audit",
      },
      root = document.querySelector("#creator-registration-checklist");
    root.replaceChildren(
      ...Object.entries(labels).map(([key, label]) => {
        const item = document.createElement("li"),
          name = document.createElement("strong"),
          state = document.createElement("span"),
          complete = Boolean(summary.registrationChecks?.[key]);
        name.textContent = label;
        state.textContent = complete ? "Complete" : "Needs attention";
        item.className = complete
          ? "creator-status-item creator-status-item--complete"
          : "creator-status-item creator-status-item--attention";
        item.append(name, state);
        return item;
      }),
    );
    document.querySelector("#creator-registration-message").textContent =
      summary.ownerOperationalAuthority
        ? "Owner authority is active for this linked Creator identity. Registration, agreement, and payout items remain visible for commercial operations; they do not block Owner catalog work."
        : summary.intakeAccess
        ? "Your Creator registration is complete. Product and listing tools are available below."
        : "Finish the items marked “Needs attention.” Historical records and remediation remain available, but new intake, uploads, publication, advertising changes, service purchases, and payout requests are blocked until current eligibility is restored.";
    const remediation = document.querySelector(
      "#creator-eligibility-remediation",
    );
    remediation.replaceChildren(
      ...(summary.currentEligibility?.remediation || []).map((item) => {
        const link = document.createElement("a");
        link.className = "button button--secondary";
        link.href = item.href;
        link.textContent =
          {
            account: "Review account and Agreement",
            profile: "Correct Creator profile",
            connect: "Complete Stripe verification",
            account_remediation: "Review account remediation",
          }[item.category] || "Resolve Creator eligibility";
        return link;
      }),
    );
  }
  function renderListings(items, files) {
    const root = document.querySelector("#creator-listing-list");
    root.replaceChildren(
      ...items.map((item) => {
        const card = document.createElement("article");
        card.className = "product-card";
        const body = document.createElement("div");
        body.className = "product-card__body";
        const title = document.createElement("h3");
        title.textContent = item.title || "Untitled PDF draft · title needed";
        if (item.coverImage) {
          const cover = document.createElement("img");
          cover.src = item.coverImage;
          cover.alt = `${item.title} cover`;
          cover.loading = "lazy";
          body.append(cover);
        }
        const meta = document.createElement("p");
        const price = item.previewOnly
          ? "preview only · not for sale"
          : item.pricingModel === "free"
          ? "free"
          : item.pricingModel === "pwyw"
            ? `PWYW · minimum $${((item.minimumPriceCents || 0) / 100).toFixed(2)} · suggested ${item.suggestedPriceCents == null ? "unset" : `$${(item.suggestedPriceCents / 100).toFixed(2)}`}`
            : item.priceCents == null
              ? "price unset"
              : `$${(item.priceCents / 100).toFixed(2)}`;
        meta.textContent = `${item.lifecycleState} · publication ${item.publicationState} · ${item.mediaType || "media unset"} · ${price} · revision ${item.revision}`;
        body.append(title, meta);
        if (item.ownerReviewHold) {
          const hold = document.createElement("p");
          hold.className = "status-note";
          hold.textContent = `Not currently for sale — Owner Review Hold began ${formatDate(item.ownerReviewHoldStartedAt)}. Tobacco Road Games reason: ${item.ownerReviewHoldReason}${item.ownerReviewHoldCorrectiveActionExpected ? " Corrective action is expected; listing metadata and permitted file work remain available." : " No Creator corrective action is currently requested."}`;
          body.append(hold);
        }
        if (item.inactivityState === "warning") {
          const warning = document.createElement("p");
          warning.className = "status-note";
          warning.textContent = `No qualifying acquisition has been recorded in the rolling 12-month window. New sales pause after ${formatDate(item.inactivityGraceEndsAt)} unless a paid sale, free acquisition, or pay-what-you-want acquisition is recorded.`;
          body.append(warning);
        }
        if (item.inactivityState === "inactive") {
          const warning = document.createElement("p");
          warning.className = "status-note";
          warning.textContent =
            "This product is inactive and cannot accept new sales. Existing customer access and listing history remain intact.";
          body.append(warning);
        }
        for (const message of item.publicationErrors) {
          const error = document.createElement("p");
          error.textContent = message;
          body.append(error);
        }
        for (const file of files.filter(
          (value) => value.listing_id === item.id,
        )) {
          const row = document.createElement("p");
          row.textContent = `${file.purpose}: ${file.normalized_filename} — ${file.validation_state}${file.validation_message ? " — " + file.validation_message : ""}`;
          body.append(row);
        }
        if (item.publicUrl) {
          const link = document.createElement("a");
          link.href = item.publicUrl;
          link.textContent = "View public listing";
          body.append(link);
        }
        if (
          (["draft", "needs_changes", "paused"].includes(item.lifecycleState) || (item.lifecycleState === "active" && item.publicationState === "published")) &&
          item.inactivityState !== "inactive" &&
          !item.ownerReviewHold
        ) {
          const edit = document.createElement("button");
          edit.className = "button button--secondary";
          edit.textContent = "Edit Listing";
          edit.onclick = () => openListingEditor(item);
          body.append(edit);
          const button = document.createElement("button");
          button.className = "button button--secondary";
          button.textContent = item.lifecycleState === "active" ? "Publish Updates" : "Publish";
          button.onclick = async () => {
            const rightsConfirmed = confirm("Confirm that you have sufficient rights to sell this material, the listing accurately represents what customers receive, and required licenses and attributions are your responsibility.");
            if (!rightsConfirmed) return;
            await api(`listings/${item.id}/publish`, { expectedRevision: item.revision, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true });
            await load();
          };
          body.append(button);
        }
        if (item.lifecycleState === "active" && item.publicationState === "published" && !item.ownerReviewHold) {
          const shelf = document.createElement("button");
          shelf.className = "button button--secondary";
          shelf.textContent = item.listingVisibility === "listed" ? "Unshelve" : "Shelve";
          shelf.onclick = async () => {
            const action = item.listingVisibility === "listed" ? "unshelve" : "shelve";
            await api(`listings/${item.id}/${action}`, { expectedRevision: item.revision, expectedProductRevision: item.productRevision });
            await load();
          };
          body.append(shelf);
        }
        if (
          item.lifecycleState === "active" &&
          item.publicationState === "published" &&
          item.productRevision &&
          !item.ownerReviewHold
        ) {
          const pause = document.createElement("button");
          pause.className = "button button--secondary";
          pause.textContent = "Pause Sales";
          pause.onclick = async () => {
            if (!confirm("Pause this product on the storefront? Existing ownership and downloads will remain intact.")) return;
            await api(`listings/${item.id}/pause`, {
              expectedRevision: item.revision,
              expectedProductRevision: item.productRevision,
            });
            await load();
          };
          body.append(pause);
        }
        if (item.inactivityState === "inactive" && !item.ownerReviewHold) {
          const button = document.createElement("button");
          button.className = "button button--secondary";
          button.textContent = "Request Reactivation";
          button.onclick = async () => {
            await api(`listings/${item.id}/reactivate`, {});
            await load();
          };
          body.append(button);
        }
        card.append(body);
        return card;
      }),
    );
  }
  function openListingEditor(item) {
    const details = document.querySelector("#creator-edit-details"),
      form = document.querySelector("#creator-edit-form");
    details.hidden = false;
    details.open = true;
    form.dataset.allowIncompleteDraft = String(["draft", "needs_changes"].includes(item.lifecycleState));
    form.listingId.value = item.id;
    form.expectedRevision.value = item.revision;
    form.title.value = item.title || "";
    form.subtitle.value = item.subtitle || "";
    form.authorCredit.value = item.authorCredit || "";
    form.publisher.value = item.publisher || "";
    form.shortDescription.value = item.shortDescription || "";
    form.longDescription.value = item.longDescription || "";
    form.pricingModel.value = item.previewOnly ? "preview-only" : (item.pricingModel || "fixed");
    form.priceCents.value = item.priceCents ?? "";
    form.minimumPriceCents.value = item.minimumPriceCents ?? "";
    form.suggestedPriceCents.value = item.suggestedPriceCents ?? "";
    form.mediaType.value = item.mediaType || "digital";
    form.format.value = (item.formats || []).join(", ");
    form.gameSystem.value = item.gameSystem || "";
    form.genre.value = item.genre || "";
    form.version.value = item.version || "";
    form.language.value = item.language || "";
    form.pricingModel.dispatchEvent(new Event("change"));
    document.querySelector("#creator-edit-status").textContent = "";
    details.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function formatDate(value) {
    return value
      ? new Date(value).toLocaleDateString()
      : "the end of the grace period";
  }
  function renderAdvertising(data) {
    document.querySelector("#creator-ad-summary").textContent =
      `${data.tier} tier · ${data.includedEntitlement} included active slot${data.includedEntitlement === 1 ? "" : "s"} · ${data.slots.filter((x) => x.slot_type === "purchased").length} active credit-funded slots · ${data.unusedCredits} unused Ad Credits · Creator Balance $${(data.creatorBalance.availableCents / 100).toFixed(2)} available.`;
    const balanceButton = document.querySelector("#creator-buy-ad-credits-balance"),
      balanceAllowed = Boolean(data.internalPurchase?.canUseBalance);
    balanceButton.hidden = !balanceAllowed;
    balanceButton.disabled = !balanceAllowed || data.creatorBalance.availableCents < 500;
    document.querySelector("#creator-ad-balance-guidance").textContent = balanceAllowed
      ? data.creatorBalance.availableCents >= 500
        ? "Use $5.00 from Creator Balance with no external card charge."
        : `Creator Balance: $${(data.creatorBalance.availableCents / 100).toFixed(2)}. The full $5.00 is required, so use external payment.`
      : "Ad Credits remain available through external payment.";
    const slots = document.querySelector("#creator-ad-slots");
    slots.replaceChildren(
      ...data.slots.map((slot) => {
        const p = document.createElement("p");
        p.textContent = `${slot.slot_type} slot ${slot.slot_index} · ${slot.creative_id ? "occupied" : "available"}${slot.expires_at ? " · expires " + formatDate(slot.expires_at) : ""}`;
        return p;
      }),
    );
    document.querySelector("#creator-ad-list").replaceChildren(
      ...data.creatives.map((item) => {
        const card = document.createElement("article");
        card.className = "product-card";
        const body = document.createElement("div");
        body.className = "product-card__body";
        const h = document.createElement("h3");
        h.textContent = item.product_title;
        const p = document.createElement("p");
        p.textContent = `${item.validation_state} · ${item.eligible ? "eligible" : item.ineligibleReason} · ${item.impressions} conservative impressions · ${item.clicks} clicks`;
        body.append(h, p);
        if (item.public_object_key) {
          const img = document.createElement("img");
          img.src = `/creator-ad-media/${item.id}`;
          img.alt = item.alt_text;
          body.append(img);
        }
        if (item.eligible) {
          for (
            let slotIndex = 1;
            slotIndex <= data.includedEntitlement;
            slotIndex++
          ) {
            const included = document.createElement("button");
            included.className = "button button--secondary";
            included.textContent = `Use included slot ${slotIndex}`;
            included.onclick = async () => {
              await api("advertising", {
                action: "activate_included",
                creativeId: item.id,
                slotIndex,
              });
              await load();
            };
            body.append(included);
          }
          const purchased = document.createElement("button");
          purchased.className = "button button--secondary";
          purchased.textContent = "Redeem 1 credit for 30-day slot";
          purchased.onclick = async () => {
            await api("advertising", {
              action: "redeem_credit",
              creativeId: item.id,
            });
            await load();
          };
          body.append(purchased);
          for (const slot of data.slots) {
            const swap = document.createElement("button");
            swap.className = "button button--secondary";
            swap.textContent = `Place in ${slot.slot_type} slot ${slot.slot_index}`;
            swap.disabled = slot.creative_id === item.id;
            swap.onclick = async () => {
              await api("advertising", {
                action: "reassign",
                slotId: slot.id,
                creativeId: item.id,
              });
              await load();
            };
            body.append(swap);
          }
        }
        card.append(body);
        return card;
      }),
    );
  }
  function fillProfile(creator) {
    const form = document.querySelector("#creator-profile-form");
    for (const field of [
      "displayName",
      "shortBio",
      "longBio",
      "profileImage",
      "logo",
      "bannerImage",
      "profileTemplate",
      "accent",
    ])
      if (form.elements[field])
        form.elements[field].value = creator[field] || "";
  }
  function revokeCreatorPdfPreview(which) {
    const url = which === "front" ? creatorPdfFrontUrl : creatorPdfBackUrl;
    if (url) URL.revokeObjectURL(url);
    if (which === "front") creatorPdfFrontUrl = "";
    else creatorPdfBackUrl = "";
    const openLink = document.querySelector(which === "front" ? "#creator-pdf-front-open" : "#creator-pdf-back-open");
    openLink.hidden = true;
    openLink.removeAttribute("href");
  }
  function showCreatorPdfPreview(which, file) {
    revokeCreatorPdfPreview(which);
    const image = document.querySelector(which === "front" ? "#creator-pdf-front-preview" : "#creator-pdf-back-preview");
    if (!file) {
      image.hidden = true;
      image.removeAttribute("src");
      return;
    }
    const url = URL.createObjectURL(file);
    if (which === "front") creatorPdfFrontUrl = url;
    else creatorPdfBackUrl = url;
    image.src = url;
    image.hidden = false;
    const openLink = document.querySelector(which === "front" ? "#creator-pdf-front-open" : "#creator-pdf-back-open");
    openLink.href = url;
    openLink.hidden = false;
  }
  function reportCreatorPdfPreparation(result) {
    const form = document.querySelector("#creator-pdf-draft-form"),
      targets = {
        title: "title", subtitle: "subtitle", author: "authorCredit", publisher: "publisher",
        shortDescription: "shortDescription", longDescription: "longDescription",
        system: "gameSystem", genre: "genre", version: "version", language: "language", format: "format",
      },
      report = document.querySelector("#creator-pdf-extraction-report"),
      legalDetails = document.querySelector("#creator-pdf-legal-details"),
      legalExcerpt = document.querySelector("#creator-pdf-legal-excerpt"),
      warnings = document.querySelector("#creator-pdf-warnings"),
      rows = [];
    const labels = {
      title: "Title", subtitle: "Subtitle", author: "Author credit", publisher: "Publisher credit",
      shortDescription: "Short description", longDescription: "Full description", system: "Game system",
      genre: "Genre", version: "Version", language: "Language", format: "Format", tags: "Keywords",
      contentDescriptors: "Content warnings", features: "Features", releaseDate: "Release date", line: "Product line", series: "Series",
    };
    for (const [key, field] of Object.entries(result.fields || {})) {
      if (key === "pageCount" || key === "legalNote") continue;
      const target = targets[key];
      const existingValue = target ? String(form.elements[target].value || "").trim() : "";
      const descriptionField = key === "shortDescription" || key === "longDescription";
      const trustworthyDescription = !descriptionField || field.confidence === "medium" || field.confidence === "high";
      if (target && !existingValue && trustworthyDescription) {
        form.elements[target].value = Array.isArray(field.value) ? field.value.join(", ") : field.value;
      }
      const row = document.createElement("li");
      row.className = `creator-pdf-field creator-pdf-field--${field.confidence || "unknown"}`;
      const heading = document.createElement("strong");
      heading.textContent = `${labels[key] || key}: `;
      const value = document.createElement("span");
      value.textContent = Array.isArray(field.value) ? field.value.join(", ") : field.value;
      const source = document.createElement("small");
      source.textContent = `${field.source} · ${field.confidence || "unrated"}${existingValue ? " · your edit kept" : ""}`;
      row.append(heading, value, source);
      rows.push(row);
    }
    for (const [key, candidates] of Object.entries(result.uncertain || {})) {
      const row = document.createElement("li");
      row.textContent = `${key}: conflicting PDF candidates — ${candidates.join(" / ")}. No value was selected; enter the credit you want to use.`;
      rows.push(row);
    }
    if (!rows.length) {
      const row = document.createElement("li");
      row.textContent = "No reliable listing details were found. Fill in the fields you can confirm.";
      rows.push(row);
    }
    report.replaceChildren(...rows);
    const legal = result.fields?.legalNote?.value || "";
    legalDetails.hidden = !legal;
    legalExcerpt.textContent = legal;
    const warningRows = [...(result.warnings || [])];
    for (const [field, label] of [["title", "Title"], ["author", "Author credit"], ["publisher", "Publisher credit"], ["shortDescription", "Short description"], ["longDescription", "Full description"], ["system", "Game system"], ["genre", "Genre"]]) {
      if (!result.fields?.[field]?.value && !result.uncertain?.[field]) warningRows.push(`${label} was not established from this PDF; please enter it if applicable.`);
    }
    warnings.replaceChildren(...warningRows.map((message) => {
      const row = document.createElement("li");
      row.textContent = message;
      return row;
    }));
  }
  async function processCreatorPdf(file) {
    const run = ++creatorPdfRun;
    if (pendingPdfDraftId && creatorPdf?.file !== file) {
      creatorPdfStatus.textContent = "Finish or retry the saved draft's PDF upload before starting another PDF.";
      creatorPdfInput.value = "";
      return;
    }
    creatorPdf = null;
    creatorPdfReview.hidden = true;
    document.querySelector("#creator-pdf-analyze").disabled = !file;
    if (!file) {
      creatorPdfStatus.textContent = "Choose a PDF to begin.";
      return;
    }
    creatorPdfStatus.textContent = "Reading PDF metadata and opening pages locally…";
    showCreatorPdfPreview("front", null);
    showCreatorPdfPreview("back", null);
    try {
      const [{ readProductPdf }, { renderDefaultPdfCoverFiles }] = await Promise.all([
        import("/assets/js/product-pdf-autofill.mjs"),
        import("/assets/js/product-pdf-images.mjs"),
      ]);
      const [details, covers] = await Promise.all([
        readProductPdf(file),
        renderDefaultPdfCoverFiles(file),
      ]);
      if (run !== creatorPdfRun || creatorPdfInput.files[0] !== file) return;
      creatorPdf = { file, frontFile: covers.frontFile, backFile: covers.backFile, pageCount: covers.pageCount, details };
      document.querySelector("#creator-pdf-page-count").textContent =
        `${covers.pageCount} PDF page${covers.pageCount === 1 ? "" : "s"} · front cover from page 1${covers.backFile ? ` · back cover from page ${covers.pageCount}` : " · one-page PDF has no separate back cover"}`;
      document.querySelector("#creator-pdf-back-replacement").disabled = !covers.backFile;
      showCreatorPdfPreview("front", covers.frontFile);
      showCreatorPdfPreview("back", covers.backFile);
      reportCreatorPdfPreparation(details);
      creatorPdfReview.hidden = false;
      creatorPdfStatus.textContent = `Prepared ${file.name} locally. Review and edit the suggestions and both cover images; the PDF has not been uploaded.`;
    } catch (error) {
      if (run !== creatorPdfRun) return;
      creatorPdfStatus.textContent = `Could not prepare this PDF: ${error.message || "Check that it is a readable, unprotected PDF."}`;
      document.querySelector("#creator-pdf-analyze").disabled = false;
    }
  }
  async function replacementAsWebp(file, name) {
    if (!file) return null;
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height), Math.sqrt(8_000_000 / (bitmap.width * bitmap.height))),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("The browser could not prepare the replacement cover.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((value) =>
        value?.type === "image/webp" ? resolve(value) : reject(new Error("The browser could not make a WebP cover.")), "image/webp", 0.9));
      return new File([blob], name, { type: "image/webp" });
    } finally {
      bitmap.close?.();
    }
  }
  creatorPdfInput.addEventListener("change", () => processCreatorPdf(creatorPdfInput.files[0] || null));
  document.querySelector("#creator-pdf-analyze").addEventListener("click", () => processCreatorPdf(creatorPdfInput.files[0] || null));
  document.querySelector("#creator-pdf-front-replacement").addEventListener("change", async (event) => {
    if (!creatorPdf || !event.currentTarget.files[0]) return;
    try {
      creatorPdf.frontFile = await replacementAsWebp(event.currentTarget.files[0], "front-cover.webp");
      showCreatorPdfPreview("front", creatorPdf.frontFile);
      creatorPdfStatus.textContent = "Replacement front cover is ready as WebP. Review it before saving the draft.";
    } catch (error) { creatorPdfStatus.textContent = error.message; }
  });
  document.querySelector("#creator-pdf-back-replacement").addEventListener("change", async (event) => {
    if (!creatorPdf?.backFile || !event.currentTarget.files[0]) return;
    try {
      creatorPdf.backFile = await replacementAsWebp(event.currentTarget.files[0], "back-cover.webp");
      showCreatorPdfPreview("back", creatorPdf.backFile);
      creatorPdfStatus.textContent = "Replacement back cover is ready as WebP. Review it before saving the draft.";
    } catch (error) { creatorPdfStatus.textContent = error.message; }
  });
  const creatorPdfForm = document.querySelector("#creator-pdf-draft-form");
  creatorPdfForm.pricingModel.addEventListener("change", () => {
    const model = creatorPdfForm.pricingModel.value;
    for (const label of creatorPdfForm.querySelectorAll("[data-pdf-fixed-price]")) label.hidden = model !== "fixed";
    for (const label of creatorPdfForm.querySelectorAll("[data-pdf-pwyw-price]")) label.hidden = model !== "pwyw";
  });
  creatorPdfForm.pricingModel.dispatchEvent(new Event("change"));
  const persistedPdfDraftMismatches = (body, listing) => {
    const text = (value) => String(value ?? "").trim();
    const mismatches = [];
    for (const [label, expected, actual] of [
      ["Title", body.title, listing.title],
      ["Short description", body.shortDescription, listing.shortDescription],
      ["Full description", body.longDescription, listing.longDescription],
      ["Game system", body.gameSystem, listing.gameSystem],
      ["Genre", body.genre, listing.genre],
      ["Subtitle", body.discovery.subtitle, listing.subtitle],
      ["Author credit", body.discovery.authorCredit, listing.authorCredit],
      ["Publisher credit", body.discovery.publisher, listing.publisher],
      ["Version", body.discovery.version, listing.version],
      ["Language", body.discovery.language, listing.language],
      ["Media type", body.mediaType, listing.mediaType],
    ]) {
      if (text(expected) !== text(actual)) mismatches.push(label);
    }
    if (JSON.stringify(body.format) !== JSON.stringify(listing.formats || [])) mismatches.push("Format");
    if (body.priceCents !== undefined && Number(body.priceCents) !== Number(listing.priceCents)) mismatches.push("Price");
    if (body.minimumPriceCents !== undefined && Number(body.minimumPriceCents) !== Number(listing.minimumPriceCents)) mismatches.push("PWYW minimum");
    if (body.suggestedPriceCents !== undefined && Number(body.suggestedPriceCents) !== Number(listing.suggestedPriceCents)) mismatches.push("PWYW suggested price");
    if (body.pricingModel !== listing.pricingModel) mismatches.push("Pricing model");
    return mismatches;
  };
  async function saveCreatorPdfDraft(continueEditing, pressedButton) {
    const buttons = [
      document.querySelector("#creator-pdf-save-draft"),
      document.querySelector("#creator-pdf-save-continue"),
    ];
    creatorPdfStatus.textContent = "Save clicked. Checking the prepared PDF and listing details…";
    if (!creatorPdf?.file) {
      creatorPdfStatus.textContent = "Draft not saved: choose a PDF and wait for its cover previews before saving.";
      return;
    }
    const originalButtonLabels = buttons.map((button) => button.textContent);
    buttons.forEach((button) => { button.disabled = true; });
    if (pressedButton) {
      pressedButton.textContent = "Saving draft…";
      pressedButton.setAttribute("aria-busy", "true");
    }
    creatorPdfStatus.textContent = "Saving listing details…";
    let listingWasWritten = false;
    let listingWasConfirmed = false;
    let fileWasConfirmed = false;
    try {
      const form = creatorPdfForm,
        value = (name) => String(form.elements.namedItem(name)?.value ?? ""),
        pricingModel = value("pricingModel"),
        price = (name) => value(name).trim() ? Number(value(name)) : undefined,
        body = {
          pdfAssisted: true,
          title: value("title").trim(),
          mediaType: value("mediaType"),
          format: value("format").split(",").map((item) => item.trim()).filter(Boolean),
          shortDescription: value("shortDescription"),
          longDescription: value("longDescription"),
          gameSystem: value("gameSystem"),
          genre: value("genre"),
          pricingModel: pricingModel === "preview-only" ? "free" : pricingModel,
          priceCents: pricingModel === "fixed" ? price("priceCents") : undefined,
          minimumPriceCents: pricingModel === "pwyw" ? price("minimumPriceCents") : undefined,
          suggestedPriceCents: pricingModel === "pwyw" ? price("suggestedPriceCents") : undefined,
          discovery: {
            subtitle: value("subtitle"),
            authorCredit: value("authorCredit"),
            publisher: value("publisher"),
            version: value("version"),
            language: value("language"),
            previewOnly: pricingModel === "preview-only",
          },
        };
      let uploadAlreadyRecorded = false;
      if (!pendingPdfDraftId) {
        const created = await api("listings", body);
        pendingPdfDraftId = created.listing.id;
        pendingPdfDraftRevision = Number(created.listing.revision || 1);
        listingWasWritten = true;
      } else if (body.title.trim()) {
        const updated = await api(`listings/${encodeURIComponent(pendingPdfDraftId)}`, {
          ...body,
          expectedRevision: pendingPdfDraftRevision,
        });
        pendingPdfDraftRevision = Number(updated.revision || pendingPdfDraftRevision + 1);
        listingWasWritten = true;
      } else {
        throw new Error("Enter a title before saving this draft so the listing details can be persisted.");
      }
      creatorPdfStatus.textContent = "Listing details sent. Verifying the saved fields…";
      const savedListingData = await api("listings"),
        savedListing = (savedListingData.listings || []).find((listing) => listing.id === pendingPdfDraftId);
      if (!savedListing) throw new Error("The server did not return the saved draft for confirmation.");
      const mismatches = persistedPdfDraftMismatches(body, savedListing);
      if (mismatches.length) throw new Error(`The server did not confirm these fields: ${mismatches.join(", ")}. Your draft is still open; no success was reported.`);
      listingWasConfirmed = true;
      uploadAlreadyRecorded = (savedListingData.files || []).some((file) =>
        file.listing_id === pendingPdfDraftId && file.purpose === "product" && file.validation_state !== "superseded");
      creatorPdfStatus.textContent = "Listing fields confirmed. Checking the PDF upload…";
      if (!uploadAlreadyRecorded) {
        const data = new FormData();
        data.set("listingId", pendingPdfDraftId);
        data.set("purpose", "product");
        data.set("file", creatorPdf.file);
        data.set("generatedFront", creatorPdf.frontFile);
        if (creatorPdf.backFile) data.set("generatedBack", creatorPdf.backFile);
        data.set("pdfPageCount", String(creatorPdf.pageCount));
        const response = await fetch(creatorApiUrl(`listings/${encodeURIComponent(pendingPdfDraftId)}/files`), {
          method: "POST",
          credentials: "same-origin",
          headers: { "x-csrf-token": csrf },
          body: data,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error?.message || payload?.error || "The PDF upload failed.");
      }
      const confirmedData = await api("listings"),
        confirmedListing = (confirmedData.listings || []).find((listing) => listing.id === pendingPdfDraftId);
      if (!confirmedListing) throw new Error("The server could not confirm the saved listing after the PDF upload.");
      const finalMismatches = persistedPdfDraftMismatches(body, confirmedListing);
      if (finalMismatches.length) throw new Error(`The server did not confirm these fields: ${finalMismatches.join(", ")}.`);
      fileWasConfirmed = (confirmedData.files || []).some((file) =>
        file.listing_id === pendingPdfDraftId && file.purpose === "product" && file.validation_state !== "superseded");
      if (!fileWasConfirmed) throw new Error("The server did not confirm the product PDF upload.");
      const listingId = pendingPdfDraftId;
      pendingPdfDraftId = "";
      const savedAt = new Date().toLocaleTimeString();
      creatorPdfStatus.textContent = `Draft fields and PDF confirmed saved at ${savedAt}. Nothing was published or shelved.`;
      creatorPdfInput.value = "";
      creatorPdfReview.hidden = true;
      creatorPdf = null;
      showCreatorPdfPreview("front", null);
      showCreatorPdfPreview("back", null);
      document.querySelector("#creator-pdf-front-replacement").value = "";
      document.querySelector("#creator-pdf-back-replacement").value = "";
      try {
        const refreshed = await load();
        if (continueEditing) {
          const item = refreshed?.listings?.find((listing) => listing.id === listingId);
          if (item) openListingEditor(item);
        }
      } catch (refreshError) {
        creatorPdfStatus.textContent = `Draft fields and PDF confirmed saved at ${savedAt}; the dashboard refresh failed: ${refreshError.message}`;
      }
    } catch (error) {
      if (listingWasConfirmed && !fileWasConfirmed) {
        creatorPdfStatus.textContent = `Draft details saved, but the PDF upload was not confirmed. Keep this PDF selected and retry: ${error.message}`;
      } else if (listingWasWritten && !listingWasConfirmed) {
        creatorPdfStatus.textContent = `Draft record created, but its fields were not confirmed. The form is still open; no success was reported: ${error.message}`;
      } else {
        creatorPdfStatus.textContent = `Draft not saved: ${error.message}`;
      }
    } finally {
      buttons.forEach((button, index) => {
        button.disabled = false;
        button.textContent = originalButtonLabels[index];
        button.removeAttribute("aria-busy");
      });
    }
  }
  creatorPdfForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveCreatorPdfDraft(event.submitter?.id === "creator-pdf-save-continue", event.submitter);
  });
  document
    .querySelector("#creator-draft-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await api("listings", {
          title: form.title.value,
          discovery: {
            subtitle: form.subtitle.value,
            authorCredit: form.authorCredit.value,
            publisher: form.publisher.value,
            version: form.version.value,
            language: form.language.value,
            previewOnly: form.pricingModel.value === "preview-only",
          },
          shortDescription: form.shortDescription.value,
          longDescription: form.longDescription.value,
          pricingModel: form.pricingModel.value === "preview-only" ? "free" : form.pricingModel.value,
          priceCents: form.pricingModel.value === "fixed" ? Number(form.priceCents.value) : undefined,
          minimumPriceCents: form.pricingModel.value === "pwyw" ? Number(form.minimumPriceCents.value) : undefined,
          suggestedPriceCents: form.pricingModel.value === "pwyw" ? Number(form.suggestedPriceCents.value) : undefined,
          mediaType: form.mediaType.value,
          format: form.format.value ? [form.format.value] : [],
          gameSystem: form.gameSystem.value,
          genre: form.genre.value,
        });
        document.querySelector("#creator-draft-status").textContent =
          "Draft created.";
        form.reset();
        await load();
      } catch (error) {
        document.querySelector("#creator-draft-status").textContent =
          error.message;
      }
    });
  const creatorDraftForm = document.querySelector("#creator-draft-form");
  creatorDraftForm.pricingModel.addEventListener("change", () => {
    const model = creatorDraftForm.pricingModel.value;
    for (const label of creatorDraftForm.querySelectorAll("[data-fixed-price]"))
      label.hidden = model !== "fixed";
    for (const label of creatorDraftForm.querySelectorAll("[data-pwyw-price]"))
      label.hidden = model !== "pwyw";
    creatorDraftForm.priceCents.required = model === "fixed";
    creatorDraftForm.minimumPriceCents.required = model === "pwyw";
    creatorDraftForm.suggestedPriceCents.required = model === "pwyw";
  });
  creatorDraftForm.pricingModel.dispatchEvent(new Event("change"));
  const creatorEditForm = document.querySelector("#creator-edit-form"),
    creatorEditDetails = document.querySelector("#creator-edit-details");
  creatorEditForm.pricingModel.addEventListener("change", () => {
    const model = creatorEditForm.pricingModel.value;
    const allowIncompleteDraft = creatorEditForm.dataset.allowIncompleteDraft === "true";
    for (const label of creatorEditForm.querySelectorAll("[data-edit-fixed-price]"))
      label.hidden = model !== "fixed";
    for (const label of creatorEditForm.querySelectorAll("[data-edit-pwyw-price]"))
      label.hidden = model !== "pwyw";
    creatorEditForm.shortDescription.required = !allowIncompleteDraft;
    creatorEditForm.longDescription.required = !allowIncompleteDraft;
    creatorEditForm.gameSystem.required = !allowIncompleteDraft;
    creatorEditForm.genre.required = !allowIncompleteDraft;
    creatorEditForm.format.required = !allowIncompleteDraft;
    creatorEditForm.priceCents.required = model === "fixed" && !allowIncompleteDraft;
    creatorEditForm.minimumPriceCents.required = model === "pwyw" && !allowIncompleteDraft;
    creatorEditForm.suggestedPriceCents.required = model === "pwyw" && !allowIncompleteDraft;
  });
  creatorEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      output = document.querySelector("#creator-edit-status"),
      model = form.pricingModel.value;
    output.textContent = "Saving listing changes…";
    try {
      const result = await api(`listings/${form.listingId.value}`, {
        expectedRevision: Number(form.expectedRevision.value),
        title: form.title.value,
        discovery: {
          subtitle: form.subtitle.value,
          authorCredit: form.authorCredit.value,
          publisher: form.publisher.value,
          version: form.version.value,
          language: form.language.value,
            previewOnly: form.pricingModel.value === "preview-only",
        },
        shortDescription: form.shortDescription.value,
        longDescription: form.longDescription.value,
        pricingModel: model === "preview-only" ? "free" : model,
        priceCents: model === "fixed" && form.priceCents.value.trim() ? Number(form.priceCents.value) : undefined,
        minimumPriceCents: model === "pwyw" && form.minimumPriceCents.value.trim() ? Number(form.minimumPriceCents.value) : undefined,
        suggestedPriceCents: model === "pwyw" && form.suggestedPriceCents.value.trim() ? Number(form.suggestedPriceCents.value) : undefined,
        mediaType: form.mediaType.value,
        format: form.format.value.split(",").map((value) => value.trim()).filter(Boolean),
        gameSystem: form.gameSystem.value,
        genre: form.genre.value,
      });
      form.expectedRevision.value = result.revision;
      const savedAt = new Date().toLocaleTimeString();
      output.textContent = `Saved at ${savedAt}. ${result.message}`;
      try {
        await load();
      } catch (refreshError) {
        output.textContent = `Saved at ${savedAt}; the listing is stored, but the dashboard did not refresh: ${refreshError.message}`;
      }
    } catch (error) {
      output.textContent = `Not saved: ${error.message}`;
    }
  });
  document.querySelector("#creator-edit-cancel").addEventListener("click", () => {
    creatorEditDetails.open = false;
    creatorEditDetails.hidden = true;
  });
  for (const button of document.querySelectorAll(
    "[data-preferred-balance-plan]",
  ))
    button.addEventListener("click", async () => {
      const output = document.querySelector("#creator-preferred-status");
      try {
        output.textContent = "Processing internal service payment…";
        const result = await api("preferred", {
          plan: button.dataset.preferredBalancePlan,
          paymentSource: "creator_balance",
          idempotencyKey: `svc_${crypto.randomUUID()}`,
        });
        output.textContent = `Preferred payment complete. Creator Balance charged $${(result.amountCents / 100).toFixed(2)}.`;
        await load();
      } catch (error) {
        output.textContent = error.message;
        await load();
      }
    });
  document
    .querySelector("#creator-preferred-monthly-stripe")
    .addEventListener("click", () => preferredAction("start_monthly_commitment"));
  document
    .querySelector("#creator-preferred-annual-stripe")
    .addEventListener("click", () => preferredAction("start_annual_stripe"));
  document
    .querySelector("#creator-preferred-do-not-renew")
    .addEventListener("click", () => preferredAction("do_not_renew"));
  async function preferredAction(action) {
    const output = document.querySelector("#creator-preferred-status");
    try {
      output.textContent = "Updating Preferred billing…";
      const result = await api("preferred", { action });
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
      else {
        output.textContent = action === "do_not_renew"
          ? "Renewal disabled. Existing commitment obligations remain due."
          : "Preferred billing updated.";
        await load();
      }
    } catch (error) {
      output.textContent = error.message;
    }
  }
  document
    .querySelector("#creator-buy-ad-credits-balance")
    .addEventListener("click", async () => {
      const output = document.querySelector("#creator-ad-status");
      try {
        output.textContent = "Processing Creator Balance payment…";
        const result = await api("advertising", {
          action: "purchase_credits_with_creator_balance",
          paymentSource: "creator_balance",
          idempotencyKey: `svc_${crypto.randomUUID()}`,
        });
        output.textContent = `Purchase complete. ${result.creditsIssued} Ad Credits issued.`;
        await load();
      } catch (error) {
        output.textContent = error.message;
        await load();
      }
    });
  document
    .querySelector("#creator-file-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        data = new FormData(form),
        listingId = data.get("listingId");
      try {
        if (data.get("purpose") === "product") {
          document.querySelector("#creator-file-status").textContent = "Generating front and back covers from the PDF...";
          const { renderDefaultPdfCoverFiles } = await import("/assets/js/product-pdf-images.mjs?v=20261107b");
          const generated = await renderDefaultPdfCoverFiles(data.get("file"));
          data.set("generatedFront", generated.frontFile);
          if (generated.backFile) data.set("generatedBack", generated.backFile);
          data.set("pdfPageCount", String(generated.pageCount));
        }
        const response = await fetch(
            `/api/creator/listings/${encodeURIComponent(listingId)}/files`,
            {
              method: "POST",
              credentials: "same-origin",
              headers: { "x-csrf-token": csrf },
              body: data,
            },
          ),
          payload = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            payload?.error?.message || payload?.error || "Upload failed.",
          );
        document.querySelector("#creator-file-status").textContent =
          data.get("purpose") === "product"
            ? "PDF and its generated cover images uploaded privately. The PDF is queued for validation."
            : "File uploaded privately and queued for validation.";
        form.elements.file.value = "";
        await load();
      } catch (error) {
        document.querySelector("#creator-file-status").textContent =
          error.message;
      }
    });
  document
    .querySelector("#creator-profile-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const body = Object.fromEntries(new FormData(form));
      body.links = [];
      try {
        await api("profile", body);
        document.querySelector("#creator-profile-status").textContent =
          "Profile saved.";
      } catch (error) {
        document.querySelector("#creator-profile-status").textContent =
          error.message;
      }
    });
  document
    .querySelector("#creator-ad-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const response = await fetch(creatorApiUrl("advertising"), {
            method: "POST",
            credentials: "same-origin",
            headers: { "x-csrf-token": csrf },
            body: new FormData(form),
          }),
          payload = await response.json();
        if (!response.ok)
          throw Error(payload.error?.message || "Upload failed.");
        document.querySelector("#creator-ad-status").textContent =
          "Ad uploaded privately for validation.";
        form.reset();
        await load();
      } catch (error) {
        document.querySelector("#creator-ad-status").textContent =
          error.message;
      }
    });
  document
    .querySelector("#creator-buy-ad-credits")
    .addEventListener("click", async () => {
      try {
        const result = await api("advertising", { action: "purchase_credits" });
        location.assign(result.checkoutUrl);
      } catch (error) {
        document.querySelector("#creator-ad-status").textContent =
          error.message;
      }
    });
  document
    .querySelector("#creator-connect-start")
    .addEventListener("click", async () => {
      const output = document.querySelector("#creator-connect-status");
      try {
        output.textContent = "Opening secure payout setup…";
        const result = await api("connect", {
          action: "start",
          creatorId: currentCreatorId,
        });
        location.assign(result.onboardingUrl);
      } catch (error) {
        output.textContent = error.message;
      }
    });
  document
    .querySelector("#creator-connect-refresh")
    .addEventListener("click", async () => {
      const output = document.querySelector("#creator-connect-status");
      try {
        const result = await api("connect", {
          action: "sync",
          creatorId: currentCreatorId,
        });
        output.textContent =
          result.state === "ready"
            ? "Payout setup is ready."
            : result.state === "action_required"
              ? "Your payout provider needs more information."
              : "Payout setup is still being reviewed or completed.";
        await load();
      } catch (error) {
        output.textContent = error.message;
      }
    });
  document
    .querySelector("#creator-connect-dashboard")
    .addEventListener("click", async () => {
      const output = document.querySelector("#creator-connect-status"),
        button = document.querySelector("#creator-connect-dashboard");
      try {
        button.disabled = true;
        output.textContent = "Opening Stripe Express Dashboard…";
        const result = await api("connect", {
          action: "dashboard",
          creatorId: currentCreatorId,
        });
        location.assign(result.dashboardUrl);
      } catch (error) {
        output.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
  document
    .querySelector("#creator-year-report-form")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      location.assign(
        `/api/creator/finance/report?period=year&value=${encodeURIComponent(event.currentTarget.elements.year.value)}`,
      );
    });
  document
    .querySelector("#creator-payout-request-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const output = document.querySelector("#creator-payout-request-result");
      try {
        const cents = Math.round(
            Number(event.currentTarget.elements.amount.value) * 100,
          ),
          result = await api("payout-request", {
            amountCents: cents,
            currency: "USD",
          });
        output.textContent = `Payout request ${result.id} recorded. External transfer has not been executed.`;
        await load();
      } catch (error) {
        output.textContent = error.message;
      }
    });
  document
    .querySelector("#owner-financial-adjustment-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        output = document.querySelector("#owner-financial-result"),
        cents = Math.round(Number(form.elements.total.value) * 100);
      try {
        output.textContent = "Recording audited adjustment…";
        ownerAdjustmentKey ||= crypto.randomUUID();
        const kind = form.elements.kind.value;
        await api("owner-financial-adjustment", {
          kind,
          newTotalCents: cents,
          expectedTotalCents: kind === "creator_funds" ? ownerFinancialSnapshot.liability.signedNetBalanceCents : ownerFinancialSnapshot.revenue.netRetainedRevenueCents,
          idempotencyKey: ownerAdjustmentKey,
          reason: form.elements.reason.value,
        });
        ownerAdjustmentKey = "";
        output.textContent = "Adjustment recorded.";
        await load();
      } catch (error) {
        output.textContent = error.message;
      }
    });
  document.querySelector("#owner-financial-adjustment-form").addEventListener("input", () => { ownerAdjustmentKey = ""; });
  document.querySelector("#creator-closure-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form=event.currentTarget,output=document.querySelector("#creator-closure-result");
    try { output.textContent="Requesting closure…"; await api("closure",{confirmation:form.elements.confirmation.value,reason:form.elements.reason.value}); output.textContent="Closure request recorded."; await load(); } catch(error){ output.textContent=error.message; }
  });
  document.querySelector("#creator-closure-refresh").addEventListener("click", async () => {
    const output=document.querySelector("#creator-closure-result"); try{output.textContent="Refreshing closure status…";await api("closure/refresh",{});await load();}catch(error){output.textContent=error.message;}
  });
  async function loadAudit() {
    const summary = await api("overview"),
      audit = document.querySelector("#creator-audit-status"),
      notices = document.querySelector("#creator-account-notices");
    audit.textContent = summary.audit
      ? `Account audit: ${summary.audit.state} · next due ${formatDate(summary.audit.next_audit_due_at)}${summary.audit.cure_deadline_at ? ` · cure deadline ${formatDate(summary.audit.cure_deadline_at)}` : ""}`
      : "Account audit schedule unavailable.";
    notices.replaceChildren(
      ...(summary.notices || []).map((item) => {
        const p = document.createElement("p");
        p.textContent = `${item.subject}: ${item.message}`;
        return p;
      }),
    );
  }
  load()
    .then(loadAudit)
    .catch((error) => {
      status.textContent = error.message;
    });
})();
