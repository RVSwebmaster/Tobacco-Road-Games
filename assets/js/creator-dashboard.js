(() => {
  const status = document.querySelector("#creator-status"),
    overview = document.querySelector("#creator-overview"),
    listingsPanel = document.querySelector("#creator-listings"),
    profilePanel = document.querySelector("#creator-profile");
  let csrf = "";
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
    const response = await fetch(`/api/creator/${path}`, {
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
        payload?.error?.message || "Creator tools are unavailable.",
      );
    return payload;
  }
  async function load() {
    const account = await fetch("/api/account/me", {
      credentials: "same-origin",
    }).then((r) => r.json());
    csrf = account.csrfToken || "";
    const [summary, profileData, finance, operations, preferred] =
      await Promise.all([
        api("overview"),
        api("profile"),
        api("finance"),
        api("operations"),
        api("preferred"),
      ]);
    document.querySelector("#creator-name").textContent =
      summary.creator.displayName;
    status.textContent = summary.intakeAccess
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
    document.querySelector("#creator-payout-status").textContent = finance
      .payout.eligible
      ? `Payout ready: ${money(finance.payout.eligibleAmountCents)} is eligible.`
      : `Payout blocked: ${finance.payout.blockedReasons.join(" ")}`;
    document.querySelector("#creator-payment-method-status").textContent =
      summary.registrationChecks?.paymentMethodReady
        ? "Payment method — Complete"
        : "Payment method — Needs attention. Stripe-hosted collection is not available yet.";
    document.querySelector("#creator-preferred").hidden = false;
    document.querySelector("#creator-preferred-summary").textContent =
      `Creator Balance ${money(preferred.balance.availableCents)} available · ${preferred.term ? `Preferred active through ${formatDate(preferred.term.term_ends_at)}` : "Standard tier"}. Automatic Creator Balance billing is not enabled.`;
    for (const button of document.querySelectorAll(
      "[data-preferred-balance-plan]",
    ))
      button.disabled =
        preferred.balance.availableCents <
        (button.dataset.preferredBalancePlan === "annual_prepaid"
          ? 20000
          : 2000);
    renderOperations(operations);
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
      summary.intakeAccess
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
        title.textContent = item.title;
        const meta = document.createElement("p");
        meta.textContent = `${item.lifecycleState} · publication ${item.publicationState} · ${item.mediaType || "media unset"} · ${item.priceCents == null ? "price unset" : `$${(item.priceCents / 100).toFixed(2)}`}`;
        body.append(title, meta);
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
          ["draft", "needs_changes", "paused"].includes(item.lifecycleState) &&
          item.inactivityState !== "inactive"
        ) {
          const button = document.createElement("button");
          button.className = "button button--secondary";
          button.textContent = "Submit for Review";
          button.onclick = async () => {
            await api(`listings/${item.id}/submit`, {});
            await load();
          };
          body.append(button);
        }
        if (item.inactivityState === "inactive") {
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
  function formatDate(value) {
    return value
      ? new Date(value).toLocaleDateString()
      : "the end of the grace period";
  }
  function renderAdvertising(data) {
    document.querySelector("#creator-ad-summary").textContent =
      `${data.tier} tier · ${data.includedEntitlement} included active slot${data.includedEntitlement === 1 ? "" : "s"} · ${data.slots.filter((x) => x.slot_type === "purchased").length} active credit-funded slots · ${data.unusedCredits} unused Ad Credits · Creator Balance $${(data.creatorBalance.availableCents / 100).toFixed(2)} available.`;
    document.querySelector("#creator-buy-ad-credits-balance").disabled =
      data.creatorBalance.availableCents < 500;
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
  document
    .querySelector("#creator-draft-form")
    .addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await api("listings", {
          title: form.title.value,
          shortDescription: form.shortDescription.value,
          priceCents:
            form.priceCents.value === "" ? null : Number(form.priceCents.value),
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
      }
    });
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
          "File uploaded privately and queued for validation.";
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
        const response = await fetch("/api/creator/advertising", {
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
        const result = await api("connect", { action: "start" });
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
        const result = await api("connect", { action: "sync" });
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
