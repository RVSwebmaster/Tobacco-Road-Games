import {
  getSessionFromRequest,
  validateSameOriginRequest,
  validateSessionCsrf,
} from "./account-auth.mjs";
import { getCreatorFinance, statementCsv } from "./creator-finance.mjs";
import { getCreatorPayoutStatus } from "./creator-payout-readiness.mjs";
import { reactivateListing } from "./product-inactivity.mjs";
import { pauseListingPublication } from "./creator-publication.mjs";
import { publishCreatorListing } from "./creator-review.mjs";
import { assertCreatorPublicationReadiness, recordListingDeclaration } from "./publication-readiness.mjs";
import { assertPublicationCapacity, assertShelfCapacity } from "./marketplace-policy.mjs";
import { prepareUpdateProduct } from "./product-catalog-d1.mjs";
import {
  getCreatorBusinessReport,
  creatorBusinessReportCsv,
  resolveReportPeriod,
} from "./creator-business-report.mjs";
import {
  getCreatorOperationalEligibility,
  getCreatorPublicationEligibility,
} from "./creator-registration.mjs";
import {
  listOperations,
  requestPayout,
  submitRemediationCorrection,
} from "./marketplace-operations.mjs";
import { getCreatorRatingSummary } from "./creator-reputation.mjs";
import { getCreatorBalance } from "./creator-balance.mjs";
import {
  adjustOwnerCreatorFunds,
  adjustTrgRevenue,
  ownerProfileFinancials,
} from "./owner-profile-finance.mjs";
import {
  creatorClosureStatus,
  refreshCreatorClosure,
  requestCreatorClosure,
} from "./creator-closure.mjs";
import {
  getPreferredBillingState,
  getPreferredBalancePaymentEligibility,
  markPreferredDoNotRenew,
  preferredGraceDays,
  startAnnualPreferredCheckout,
  startMonthlyPreferredCommitment,
} from "./preferred-billing.mjs";
import {
  purchaseServiceWithCreatorBalance,
  SERVICE_PRICING,
} from "./creator-service-purchases.mjs";
import {
  listCreatorMembershipIdentities,
  selectCreatorIdentity,
} from "./creator-identity-selection.mjs";
import {
  getCreatorProfileShelfState,
  saveCreatorProfileShelf,
} from "./creator-profile-shelf.mjs";

const EDITABLE_STATES = new Set(["draft", "needs_changes", "paused"]);
const MEDIA_TYPES = new Set(["", "digital", "physical", "hybrid"]);
const PRICING_MODELS = new Set(["fixed", "free", "pwyw"]);
const PROFILE_TEMPLATES = new Set(["catalog", "bookshelf"]);

export async function handleCreatorRequest(request, env = {}, options = {}) {
  const database = options.database || env.TRG_ORDERS;
  const session = await getSessionFromRequest(
    request,
    env,
    options.sessionOptions || {},
  );
  if (!session.valid)
    return json(
      {
        error: {
          code: "not_authenticated",
          message: "Sign in to access creator tools.",
        },
      },
      401,
    );
  const route = routePath(request);
  if (request.method === "GET" && route === "identity-options") {
    const identities = await listCreatorMembershipIdentities(
      database,
      session.user.id,
    );
    return json({
      creators: identities.map((creator) => ({
        id: creator.id,
        slug: creator.slug,
        displayName: creator.display_name,
        permission: creator.permission,
      })),
    });
  }
  const creator = await resolveCreator(database, session.user.id, request);
  if (!creator)
    return json(
      {
        error: {
          code: "creator_access_denied",
          message: "Seller registration is incomplete or restricted.",
        },
      },
      403,
    );
  const readiness = await getCreatorOperationalEligibility(
    database,
    creator.id,
    {
      markInitialCompletion: true,
      nowMs: options.nowMs,
    },
  );
  const publicationReadiness = await getCreatorPublicationEligibility(
    database,
    creator.id,
    { markInitialCompletion: false, nowMs: options.nowMs },
  );
  if (
    requiresPublicationEligibility(request.method, route) &&
    !publicationReadiness.publicationEligible
  )
    return registrationRequired({
      ...publicationReadiness,
      reasonCodes: publicationReadiness.publicationReasonCodes,
    });
  if (requiresCurrentEligibility(request.method, route) && !readiness.eligible)
    return registrationRequired(readiness);
  if (request.method !== "GET") {
    if (
      !validateSameOriginRequest(request) ||
      !(await validateSessionCsrf(request, session)).valid
    )
      return json(
        {
          error: {
            code: "request_not_verified",
            message: "The creator request could not be verified.",
          },
        },
        403,
      );
  }
  if (request.method === "GET" && route === "overview")
    return overview(database, creator, readiness);
  if (request.method === "GET" && route === "closure") {
    try {
      return json(
        await creatorClosureStatus(database, {
          creatorId: creator.id,
          userId: session.user.id,
          nowMs: options.nowMs,
        }),
      );
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (request.method === "POST" && route === "closure") {
    try {
      const body = await request.json();
      return json(
        await requestCreatorClosure(database, {
          creatorId: creator.id,
          userId: session.user.id,
          confirmation: body.confirmation,
          reason: body.reason,
          nowMs: options.nowMs,
        }),
      );
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (request.method === "POST" && route === "closure/refresh") {
    try {
      return json(await refreshCreatorClosure(database, { creatorId: creator.id, userId: session.user.id, nowMs: options.nowMs, requireOwner: true }));
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (request.method === "GET" && route === "listings")
    return listings(database, creator);
  if (request.method === "GET" && route === "profile")
    return json({ creator: publicCreator(creator) });
  if (request.method === "POST" && route === "profile")
    return updateProfile(request, database, creator);
  if (request.method === "GET" && route === "profile-shelf") {
    try {
      return json(await getCreatorProfileShelfState(database, creator.id, session.user.id, options.nowMs));
    } catch (error) {
      return profileShelfError(error);
    }
  }
  if (request.method === "POST" && route === "profile-shelf") {
    try {
      const body = await bodyJson(request);
      return json(await saveCreatorProfileShelf(database, creator.id, session.user.id, body.productIds, options.nowMs));
    } catch (error) {
      return profileShelfError(error);
    }
  }
  if (request.method === "POST" && route === "listings")
    return createDraft(request, database, creator);
  if (request.method === "POST" && /^listings\/[^/]+$/.test(route))
    return updateListing(request, database, creator, route.split("/")[1]);
  if (request.method === "POST" && /^listings\/[^/]+\/submit$/.test(route))
    return changeListingState(
      request,
      database,
      creator,
      route.split("/")[1],
      "submitted",
    );
  if (request.method === "POST" && /^listings\/[^/]+\/publish$/.test(route))
    return publishOwnListing(request, database, creator, route.split("/")[1], env, options);
  if (request.method === "POST" && /^listings\/[^/]+\/shelve$/.test(route))
    return changeListingShelf(request, database, creator, route.split("/")[1], true, options);
  if (request.method === "POST" && /^listings\/[^/]+\/unshelve$/.test(route))
    return changeListingShelf(request, database, creator, route.split("/")[1], false, options);
  if (request.method === "POST" && /^listings\/[^/]+\/withdraw$/.test(route))
    return changeListingState(
      request,
      database,
      creator,
      route.split("/")[1],
      "withdrawn",
    );
  if (request.method === "POST" && /^listings\/[^/]+\/pause$/.test(route))
    return pauseCreatorListing(
      request,
      database,
      creator,
      route.split("/")[1],
      env,
      options,
    );
  if (
    request.method === "POST" &&
    /^listings\/[^/]+\/reactivate$/.test(route)
  ) {
    try {
      return json({
        ok: true,
        ...(await reactivateListing(database, {
          listingId: route.split("/")[1],
          creatorId: creator.id,
          actorId: session.user.id,
          nowMs: options.nowMs,
        })),
      });
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (request.method === "GET" && route === "analytics")
    return analytics(database, creator);
  if (request.method === "GET" && route === "finance")
    return creatorFinance(request, database, creator, {
      ...options,
      env,
      userId: session.user.id,
    });
  if (request.method === "POST" && route === "owner-financial-adjustment") {
    try {
      const body = await request.json();
      const input = {
        creatorId: creator.id,
        userId: session.user.id,
        newTotalCents: body.newTotalCents,
        expectedTotalCents: body.expectedTotalCents,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason,
        nowMs: options.nowMs,
      };
      const adjustment =
        body.kind === "creator_funds"
          ? await adjustOwnerCreatorFunds(database, input)
          : body.kind === "trg_revenue"
            ? await adjustTrgRevenue(database, input)
            : (() => {
                throw new Error("Choose Creator funds or Tobacco Road Games earnings.");
              })();
      return json({ ok: true, adjustment });
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (request.method === "GET" && route === "operations")
    return json(await listOperations(database, { creatorId: creator.id }));
  if (request.method === "GET" && route === "preferred") {
    const term = await database
      .prepare(
        "SELECT * FROM creator_preferred_terms WHERE creator_id=? AND status='active' AND term_ends_at>? ORDER BY term_ends_at DESC LIMIT 1",
      )
      .bind(creator.id, new Date(options.nowMs || Date.now()).toISOString())
      .first();
    const balance = await getCreatorBalance(database, {
      creatorId: creator.id,
      userId: session.user.id,
      nowMs: options.nowMs,
    });
    const internalPurchase = await getPreferredBalancePaymentEligibility(
        database,
        {
          creatorId: creator.id,
          creatorEligible: readiness.eligible,
          nowMs: options.nowMs || Date.now(),
        },
      ),
      billing = internalPurchase.billing;
    return json({
      term,
      billing,
      balance,
      pricing: {
        monthlyCommitmentCents: SERVICE_PRICING.preferred_monthly.amountCents,
        annualPrepaidCents: SERVICE_PRICING.preferred_annual.amountCents,
      },
      automaticBalanceBilling: false,
      automaticStripeInstallments: true,
      paymentMethod: {
        ready: Boolean(readiness.paymentMethodReady),
      },
      internalPurchase: {
        canUseBalance: internalPurchase.canUseBalance,
        preferred: internalPurchase.preferred,
        monthlyEligible: internalPurchase.monthlyEligible,
        annualRenewalEligible: internalPurchase.annualRenewalEligible,
      },
    });
  }
  if (request.method === "POST" && route === "preferred") {
    try {
      const body = await bodyJson(request);
      if (body.action === "do_not_renew")
        return json({
          ok: true,
          ...(await markPreferredDoNotRenew(database, {
            creatorId: creator.id,
            userId: session.user.id,
            nowMs: options.nowMs,
          })),
        });
      if (body.action === "start_annual_stripe")
        return json({
          ok: true,
          ...(await startAnnualPreferredCheckout(database, {
            creatorId: creator.id,
            userId: session.user.id,
            email: session.user.email_normalized,
            env,
            fetchImpl: options.fetchImpl,
            nowMs: options.nowMs,
          })),
        });
      if (body.action === "start_monthly_commitment")
        return json({
          ok: true,
          ...(await startMonthlyPreferredCommitment(database, {
            creatorId: creator.id,
            userId: session.user.id,
            env,
            fetchImpl: options.fetchImpl,
            nowMs: options.nowMs,
          })),
        });
      const
        sku =
          body.plan === "annual_prepaid"
            ? "preferred_annual"
            : body.plan === "monthly_commitment"
              ? "preferred_monthly"
              : "";
      if (body.paymentSource !== "creator_balance" || !sku)
        throw new Error(
          "Choose a valid Preferred plan and explicitly select Creator Balance.",
        );
      return json(
        {
          ok: true,
          ...(await purchaseServiceWithCreatorBalance(database, {
            creatorId: creator.id,
            userId: session.user.id,
            sku,
            idempotencyKey: String(body.idempotencyKey || ""),
            nowMs: options.nowMs,
            graceDays: preferredGraceDays(env),
          })),
        },
        201,
      );
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (request.method === "POST" && route === "payout-request") {
    try {
      const body = await bodyJson(request);
      return json(
        {
          ok: true,
          ...(await requestPayout(database, {
            creatorId: creator.id,
            amountCents: Number(body.amountCents),
            currency: body.currency || "USD",
            nowMs: options.nowMs,
          })),
        },
        201,
      );
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (
    request.method === "POST" &&
    /^remediations\/[^/]+\/submit$/.test(route)
  ) {
    try {
      const body = await bodyJson(request);
      return json({
        ok: true,
        ...(await submitRemediationCorrection(database, {
          caseId: route.split("/")[1],
          creatorId: creator.id,
          objectKey: body.objectKey,
          nowMs: options.nowMs,
        })),
      });
    } catch (error) {
      return invalid(error.message);
    }
  }
  if (request.method === "GET" && route === "finance/statement")
    return creatorStatement(request, database, creator, options);
  if (request.method === "GET" && route === "finance/report")
    return creatorReport(request, database, creator, options);
  if (request.method === "GET" && route === "bundles")
    return bundles(database, creator);
  if (request.method === "POST" && route === "bundles")
    return createBundle(request, database, creator);
  return json(
    { error: { code: "not_found", message: "Creator operation not found." } },
    404,
  );
}

async function resolveCreator(db, userId, request) {
  const requested = new URL(request.url).searchParams.get("creator") || "";
  const rows = await listCreatorMembershipIdentities(db, userId);
  for (const row of rows)
    row.marketplace_status =
      row.registration_status ||
      { approved: "active", pending: "incomplete", suspended: "suspended" }[
        row.marketplace_status
      ] ||
      "incomplete";
  if (!rows.length) return null;
  return selectCreatorIdentity(rows, requested);
}
async function overview(db, creator, readiness) {
  const counts = await db
    .prepare(
      `SELECT COUNT(*) total, SUM(lifecycle_state='active') active, SUM(lifecycle_state='draft') draft, SUM(lifecycle_state IN ('paused','rejected','needs_changes')) unavailable FROM creator_listings WHERE creator_id=?`,
    )
    .bind(creator.id)
    .first();
  const sales = await salesRows(db, creator.id);
  let audit = null,
    notices = [];
  try {
    audit = await db
      .prepare("SELECT * FROM creator_account_audit_states WHERE creator_id=?")
      .bind(creator.id)
      .first();
    notices = await all(
      db
        .prepare(
          "SELECT notice_type,subject,message,created_at,read_at FROM creator_account_notices WHERE creator_id=? ORDER BY created_at DESC LIMIT 20",
        )
        .bind(creator.id),
    );
  } catch {}
  return json({
    creator: publicCreator(creator),
    overview: {
      activeListings: Number(counts?.active || 0),
      draftListings: Number(counts?.draft || 0),
      unavailableListings: Number(counts?.unavailable || 0),
      recentOrderCount: sales.orderCount,
      grossSalesCents: sales.grossCents,
      profileStatus: creator.marketplace_status,
    },
    intakeAccess: readiness.eligible,
    currentEligibility: {
      eligible: readiness.eligible,
      reasonCodes: readiness.reasonCodes,
      remediation: readiness.remediation,
      evaluatedAt: readiness.currentEligibilityEvaluatedAt,
    },
    historicalRegistration: {
      completed: readiness.historicallyCompleted,
      completedAt:
        creator.intake_registration_completed_at ||
        creator.registration_completed_at ||
        null,
    },
    registrationChecks: readiness.checks,
    audit,
    notices,
  });
}
async function listings(db, creator) {
  const listingRows = await all(
    db
      .prepare(
        `SELECT cl.*,
          mp.id catalog_product_id,mp.slug catalog_slug,mp.title catalog_title,
          mp.publication_state catalog_publication_state,mp.pricing_model catalog_pricing_model,
          mp.price_cents catalog_price_cents,mp.minimum_price_cents catalog_minimum_price_cents,
          mp.suggested_price_cents catalog_suggested_price_cents,mp.media_type catalog_media_type,
          mp.cover_r2_key catalog_cover_r2_key,mp.revision catalog_revision,
          mp.updated_at catalog_updated_at,mp.storefront_visibility catalog_listing_visibility,
          EXISTS(SELECT 1 FROM creator_listing_files cf
            WHERE cf.listing_id=cl.id AND cf.creator_id=cl.creator_id
              AND ((cf.purpose='cover' AND cf.content_type='image/webp')
                OR (cf.purpose='product' AND cf.generated_cover_key IS NOT NULL))
              AND cf.validation_state<>'superseded') has_cover_file
         FROM creator_listings cl
         LEFT JOIN marketplace_products mp ON mp.creator_listing_id=cl.id
         WHERE cl.creator_id=? ORDER BY cl.updated_at DESC,cl.title`,
      )
      .bind(creator.id),
  );
  const files = await all(
    db
      .prepare(
        "SELECT id,listing_id,purpose,normalized_filename,content_type,size_bytes,validation_state,validation_message,uploaded_at,validated_at FROM creator_listing_files WHERE creator_id=? AND validation_state<>'superseded' ORDER BY uploaded_at DESC",
      )
      .bind(creator.id),
  );
  return json({
    creator: publicCreator(creator),
    listings: listingRows.map(publicListing),
    files,
  });
}
async function updateProfile(request, db, creator) {
  if (creator.permission !== "manager") return forbidden();
  const body = await bodyJson(request),
    displayName = bounded(body.displayName, 80),
    shortBio = bounded(body.shortBio, 500),
    longBio = bounded(body.longBio, 5000),
    accent = bounded(body.accent, 32),
    profileImage = safeUrl(body.profileImage),
    logo = safeUrl(body.logo),
    bannerImage = safeUrl(body.bannerImage),
    profileTemplate = String(body.profileTemplate || "catalog"),
    links = validLinks(body.links);
  if (
    !displayName ||
    !PROFILE_TEMPLATES.has(profileTemplate) ||
    links === null ||
    [profileImage, logo, bannerImage].includes(null)
  )
    return invalid("Profile fields are invalid.");
  const now = new Date().toISOString();
  await db
    .prepare(
      "UPDATE marketplace_creators SET display_name=?,profile_image=?,logo=?,banner_image=?,short_bio=?,long_bio=?,profile_template=?,accent=?,links_json=?,updated_at=? WHERE id=?",
    )
    .bind(
      displayName,
      profileImage,
      logo,
      bannerImage,
      shortBio,
      longBio,
      profileTemplate,
      accent,
      JSON.stringify(links),
      now,
      creator.id,
    )
    .run();
  return json({ ok: true, message: "Creator profile saved." });
}
async function createDraft(request, db, creator) {
  if (!["manager", "editor"].includes(creator.permission)) return forbidden();
  const body = await bodyJson(request),
    title = bounded(body.title, 160),
    mediaType = String(body.mediaType || "");
  const now = new Date().toISOString(),
    id = crypto.randomUUID(),
    slug = slugify(body.slug || title) || (body.pdfAssisted === true ? `pdf-draft-${id.slice(0, 8)}` : "");
  if ((!title && body.pdfAssisted !== true) || !slug || !MEDIA_TYPES.has(mediaType))
    return invalid("Title, slug, or media type is invalid.");
  let pricing;
  try {
    pricing = normalizeListingPricing(body);
  } catch (error) {
    return invalid(error.message);
  }
  try {
    await db
      .prepare(
        `INSERT INTO creator_listings(id,creator_id,slug,title,short_description,long_description,lifecycle_state,listed_price_cents,pricing_model,suggested_price_cents,minimum_price_cents,media_type,format_json,game_system,genre,discovery_json,cover_image,created_at,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        creator.id,
        slug,
        title,
        bounded(body.shortDescription, 500),
        bounded(body.longDescription, 10000),
        pricing.priceCents,
        pricing.pricingModel,
        pricing.suggestedPriceCents,
        pricing.minimumPriceCents,
        mediaType,
        JSON.stringify(list(body.format)),
        bounded(body.gameSystem, 120),
        bounded(body.genre, 80),
        JSON.stringify(safeDiscovery(body.discovery)),
        safeUrl(body.coverImage) || "",
        now,
        now,
      )
      .run();
  } catch {
    return json(
      {
        error: {
          code: "listing_conflict",
          message: "That listing slug is unavailable.",
        },
      },
      409,
    );
  }
  return json(
    { ok: true, listing: { id, slug, title, lifecycleState: "draft" } },
    201,
  );
}
async function updateListing(request, db, creator, id) {
  if (!["manager", "editor"].includes(creator.permission)) return forbidden();
  const current = await db
    .prepare("SELECT * FROM creator_listings WHERE id=? AND creator_id=?")
    .bind(id, creator.id)
    .first();
  if (!current) return notFound();
  if (!(EDITABLE_STATES.has(current.lifecycle_state) || (current.lifecycle_state === "active" && current.publication_state === "published")) && Number(current.owner_review_hold) !== 1)
    return invalid(
      "Only drafts, paused listings, or listings needing changes can be edited.",
    );
  const body = await bodyJson(request),
    expectedRevision = body.expectedRevision === undefined ? Number(current.revision) : Number(body.expectedRevision),
    mediaType =
      body.mediaType === undefined
        ? current.media_type
        : String(body.mediaType);
  if (!MEDIA_TYPES.has(mediaType)) return invalid("Media type is invalid.");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    return invalid("A current listing revision is required.");
  if (expectedRevision !== Number(current.revision))
    return listingRevisionConflict(current);
  let pricing;
  try {
    pricing = normalizeListingPricing(body, current);
  } catch (error) {
    return invalid(error.message);
  }
  const title =
    body.title === undefined ? current.title : bounded(body.title, 160);
  if (!title) return invalid("Title is required.");
  const result = await db
    .prepare(
      `UPDATE creator_listings SET title=?,short_description=?,long_description=?,listed_price_cents=?,pricing_model=?,suggested_price_cents=?,minimum_price_cents=?,sale_price_cents=?,sale_start=?,sale_end=?,media_type=?,format_json=?,game_system=?,genre=?,discovery_json=?,cover_image=?,updated_at=?,revision=revision+1 WHERE id=? AND creator_id=? AND revision=?`,
    )
    .bind(
      title,
      body.shortDescription === undefined
        ? current.short_description
        : bounded(body.shortDescription, 500),
      body.longDescription === undefined
        ? current.long_description
        : bounded(body.longDescription, 10000),
      pricing.priceCents,
      pricing.pricingModel,
      pricing.suggestedPriceCents,
      pricing.minimumPriceCents,
      body.salePriceCents === undefined
        ? current.sale_price_cents
        : money(body.salePriceCents),
      body.saleStart === undefined
        ? current.sale_start
        : safeDate(body.saleStart),
      body.saleEnd === undefined ? current.sale_end : safeDate(body.saleEnd),
      mediaType,
      body.format === undefined
        ? current.format_json
        : JSON.stringify(list(body.format)),
      body.gameSystem === undefined
        ? current.game_system
        : bounded(body.gameSystem, 120),
      body.genre === undefined ? current.genre : bounded(body.genre, 80),
      body.discovery === undefined
        ? current.discovery_json
        : JSON.stringify(safeDiscovery({
            ...parseDiscovery(current.discovery_json),
            ...body.discovery,
          })),
      body.coverImage === undefined
        ? current.cover_image
        : safeUrl(body.coverImage) || "",
      new Date().toISOString(),
      id,
      creator.id,
      expectedRevision,
    )
    .run();
  if (changeCount(result) !== 1) {
    const latest = await db.prepare("SELECT revision,lifecycle_state,publication_state FROM creator_listings WHERE id=?").bind(id).first();
    return listingRevisionConflict(latest);
  }
  return json({ ok: true, message: "Listing changes saved. Publish when you are ready.", revision: expectedRevision + 1 });
}

async function publishOwnListing(request, db, creator, id, env, options) {
  if (!["manager", "editor"].includes(creator.permission)) return forbidden();
  const listing = await db.prepare("SELECT * FROM creator_listings WHERE id=? AND creator_id=?").bind(id, creator.id).first();
  if (!listing) return notFound();
  if (Number(listing.owner_review_hold) === 1) return invalid("Tobacco Road Games has placed this listing on Owner Review Hold.");
  const body = await bodyJson(request), expectedRevision = body.expectedRevision === undefined ? Number(listing.revision) : Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(listing.revision)) return listingRevisionConflict(listing);
  try {
    await assertCreatorSubmissionReady(db, listing);
    if (!listing.publication_state || listing.publication_state !== "published") await assertPublicationCapacity(db, listing, options.nowMs);
    if (body.rightsConfirmed !== true || body.representationConfirmed !== true || body.licensesConfirmed !== true) return invalid("All product declarations are required.");
    await recordListingDeclaration(db, { listingId: id, creatorId: creator.id, userId: creator.user_id, rightsConfirmed: true, representationConfirmed: true, licensesConfirmed: true, nowMs: options.nowMs });
    await assertCreatorPublicationReadiness(db, listing);
    const result = await publishCreatorListing(db, env.TRG_PRODUCTS, { listingId: id, expectedRevision, actorId: creator.user_id, actorType: "creator", note: "Creator self-published.", requireSubmitted: false, nowMs: options.nowMs });
    return json({ ok: true, state: "published", product: result });
  } catch (error) {
    return invalid(error.message || "The Creator publication could not be completed.");
  }
}

async function changeListingShelf(request, db, creator, id, shelve, options) {
  if (!["manager", "editor"].includes(creator.permission)) return forbidden();
  const listing = await db.prepare("SELECT cl.*,mp.id product_id,mp.revision product_revision,mp.publication_state product_publication_state,mp.storefront_visibility FROM creator_listings cl JOIN marketplace_products mp ON mp.creator_listing_id=cl.id WHERE cl.id=? AND cl.creator_id=?").bind(id, creator.id).first();
  if (!listing) return notFound();
  if (Number(listing.owner_review_hold) === 1) return invalid("Tobacco Road Games has placed this listing on Owner Review Hold.");
  if (listing.product_publication_state !== "published" || listing.lifecycle_state !== "active") return invalid("Only a published listing can be shelved.");
  const body = await bodyJson(request), expectedRevision = body.expectedRevision === undefined ? Number(listing.revision) : Number(body.expectedRevision), expectedProductRevision = body.expectedProductRevision === undefined ? Number(listing.product_revision) : Number(body.expectedProductRevision);
  if (expectedRevision !== Number(listing.revision) || expectedProductRevision !== Number(listing.product_revision)) return listingRevisionConflict(listing);
  try {
    if (shelve) await assertShelfCapacity(db, listing, options.nowMs);
    const prepared = await prepareUpdateProduct(db, listing.product_id, { listingVisibility: shelve ? "listed" : "unlisted" }, { expectedRevision: expectedProductRevision, nowMs: options.nowMs });
    const now = new Date(Number.isFinite(options.nowMs) ? options.nowMs : Date.now()).toISOString();
    await db.batch([
      prepared.statement,
      db.prepare("UPDATE creator_listings SET updated_at=?,revision=revision+1 WHERE id=? AND creator_id=? AND revision=?").bind(now, id, creator.id, expectedRevision),
      db.prepare("INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at) VALUES(?,?,\'creator\',?,?,?,?)").bind(id, creator.id, creator.user_id, shelve ? "shelved" : "unshelved", JSON.stringify({ productId: listing.product_id, productRevision: prepared.expectedNextRevision }), now)
    ]);
    return json({ ok: true, state: shelve ? "shelved" : "unshelved", revision: expectedRevision + 1, productRevision: prepared.expectedNextRevision });
  } catch (error) { return invalid(error.message || "The shelf change could not be completed."); }
}
async function changeListingState(request, db, creator, id, state) {
  if (!["manager", "editor"].includes(creator.permission)) return forbidden();
  const current = await db
    .prepare(
      "SELECT * FROM creator_listings WHERE id=? AND creator_id=?",
    )
    .bind(id, creator.id)
    .first();
  if (!current) return notFound();
  const body = await bodyJson(request);
  const expectedRevision = body.expectedRevision === undefined ? Number(current.revision) : Number(body.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
    return invalid("A current listing revision is required.");
  if (expectedRevision !== Number(current.revision))
    return listingRevisionConflict(current);
  if (Number(current.owner_review_hold) === 1)
    return invalid("Tobacco Road Games has placed this listing on Owner Review Hold. Corrective edits and file replacement remain available, but only Tobacco Road Games can restore saleability.");
  if (state === "submitted" && !EDITABLE_STATES.has(current.lifecycle_state))
    return invalid("This listing cannot be submitted from its current state.");
  if (
    state === "withdrawn" &&
    (current.lifecycle_state !== "submitted" ||
      current.publication_state !== "not_approved")
  )
    return invalid("Only a pending submission can be withdrawn.");
  const now = new Date().toISOString();
  if (state === "submitted") {
    try {
      await assertCreatorSubmissionReady(db, current);
    } catch (error) {
      return invalid(error.message);
    }
    let schema = true;
    try {
      await db
        .prepare("SELECT 1 FROM creator_listing_declarations LIMIT 1")
        .first();
    } catch {
      schema = false;
    }
    if (schema) {
      try {
        await recordListingDeclaration(db, {
          listingId: id,
          creatorId: creator.id,
          userId: creator.user_id,
          rightsConfirmed: body.rightsConfirmed,
          representationConfirmed: body.representationConfirmed,
          licensesConfirmed: body.licensesConfirmed,
        });
      } catch (error) {
        return invalid(error.message);
      }
    }
  }
  const nextState = state === "withdrawn" ? "draft" : state;
  const nextRevision = expectedRevision + 1;
  try {
    await db.batch([
      db
      .prepare(
        `UPDATE creator_listings SET lifecycle_state=?,publication_state='not_approved',submitted_at=CASE WHEN ?='submitted' THEN ? ELSE submitted_at END,updated_at=?,revision=revision+1 WHERE id=? AND creator_id=? AND revision=?`,
      )
      .bind(nextState, nextState, now, now, id, creator.id, expectedRevision),
      db
      .prepare(
        `INSERT INTO creator_publication_audit(listing_id,creator_id,actor_type,actor_id,action,context_json,created_at)
         VALUES((SELECT id FROM creator_listings WHERE id=? AND creator_id=? AND lifecycle_state=? AND revision=?),?,'creator',?,?,?,?)`,
      )
      .bind(
        id,
        creator.id,
        nextState,
        nextRevision,
        creator.id,
        creator.user_id,
        state === "submitted" ? "submitted" : "submission_withdrawn",
        JSON.stringify({ from: current.lifecycle_state, to: nextState }),
        now,
      ),
    ]);
  } catch (cause) {
    if (/NOT NULL constraint failed: creator_publication_audit\.listing_id/i.test(String(cause?.message || cause))) {
      const latest = await db.prepare("SELECT revision,lifecycle_state,publication_state FROM creator_listings WHERE id=?").bind(id).first();
      return listingRevisionConflict(latest);
    }
    throw cause;
  }
  return json({ ok: true, state: nextState });
}

async function pauseCreatorListing(request, db, creator, id, env, options) {
  if (!["manager", "editor"].includes(creator.permission)) return forbidden();
  const listing = await db
    .prepare("SELECT * FROM creator_listings WHERE id=? AND creator_id=?")
    .bind(id, creator.id)
    .first();
  if (!listing) return notFound();
  if (
    listing.lifecycle_state !== "active" ||
    listing.publication_state !== "published" ||
    !listing.public_product_slug
  )
    return invalid("Only an active published listing can be taken off sale.");
  const body = await bodyJson(request);
  return pauseListingPublication({
    listing,
    database: db,
    env,
    actorType: "creator",
    actorId: creator.user_id,
    expectedListingRevision: body.expectedRevision,
    expectedProductRevision: body.expectedProductRevision,
    nowMs: options.nowMs,
  });
}
async function analytics(db, creator) {
  const totals = await salesRows(db, creator.id);
  let reputation = null;
  try {
    reputation = await getCreatorRatingSummary(db, creator.id, {
      includePrivate: true,
    });
  } catch (error) {
    if (!/no such table:\s*creator_reputation_ratings/i.test(String(error)))
      throw error;
  }
  const products = await all(
    db
      .prepare(
        `SELECT cl.slug,cl.title,COUNT(DISTINCT o.id) order_count,COUNT(CASE WHEN o.id IS NOT NULL THEN oi.id END) units_sold,COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.line_total_cents ELSE 0 END),0) gross_cents FROM creator_listings cl LEFT JOIN order_items oi ON oi.product_slug=cl.source_product_slug LEFT JOIN orders o ON o.id=oi.order_id AND o.payment_status='paid' WHERE cl.creator_id=? GROUP BY cl.id ORDER BY units_sold DESC,cl.title`,
      )
      .bind(creator.id),
  );
  return json({
    creator: publicCreator(creator),
    analytics: {
      ...totals,
      reputation,
      products: products.map((row) => ({
        slug: row.slug,
        title: row.title,
        orderCount: Number(row.order_count),
        unitsSold: Number(row.units_sold),
        grossCents: Number(row.gross_cents),
      })),
    },
  });
}
async function creatorFinance(request, db, creator, options) {
  const owner = await db
      .prepare(
        "SELECT owner_user_id FROM creator_identity_ownership WHERE creator_id=? AND account_status='active'",
      )
      .bind(creator.id)
      .first(),
    url = new URL(request.url),
    finance = await getCreatorFinance(db, creator.id, {
      from: safeDate(url.searchParams.get("from")) || "",
      to: safeDate(url.searchParams.get("to")) || "",
      nowMs: options.nowMs,
    }),
    payout = await getCreatorPayoutStatus(db, creator.id, {
      env: options.env || {},
      nowMs: options.nowMs,
    }),
    creatorBalance = await getCreatorBalance(db, {
      creatorId: creator.id,
      userId: owner.owner_user_id,
      nowMs: options.nowMs,
    }),
    serviceResult = await db
      .prepare(
        "SELECT p.id,p.service_type,p.service_sku,p.quantity,p.amount_cents,p.currency,p.payment_source,p.settlement_method,CASE WHEN p.processor_fee_authoritative=1 THEN p.processor_fee_cents ELSE NULL END processor_fee_cents,p.status,p.created_at,p.completed_at,p.reversed_at,cp.billing_plan,cp.coverage_starts_at,cp.coverage_ends_at FROM marketplace_service_purchases p LEFT JOIN creator_identity_coverage_periods cp ON cp.service_purchase_id=p.id WHERE p.creator_id=? ORDER BY p.created_at DESC LIMIT 100",
      )
      .bind(creator.id)
      .all(),
    ownerFinancials = await ownerProfileFinancials(
      db,
      creator.id,
      options.userId,
      options.nowMs,
    ).catch(() => null);
  return json({
    creator: publicCreator(creator),
    ...finance,
    payout,
    creatorBalance,
    ownerFinancials,
    servicePurchases: serviceResult.results || [],
  });
}
async function creatorStatement(request, db, creator, options) {
  const url = new URL(request.url),
    month = String(
      url.searchParams.get("month") ||
        new Date(options.nowMs || Date.now()).toISOString().slice(0, 7),
    );
  if (!/^\d{4}-\d{2}$/.test(month))
    return invalid("Statement month must use YYYY-MM.");
  const from = `${month}-01T00:00:00.000Z`,
    to = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1),
    ).toISOString(),
    finance = await getCreatorFinance(db, creator.id, {
      from,
      to,
      nowMs: options.nowMs,
    }),
    closing = await getCreatorFinance(db, creator.id, {
      to,
      nowMs: options.nowMs,
    });
  finance.summary.unpaidBalanceCents = closing.summary.unpaidBalanceCents;
  return new Response(statementCsv(creator, { from, to }, finance), {
    headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${creator.slug}-${month}-statement.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
async function creatorReport(request, db, creator, options) {
  try {
    const url = new URL(request.url),
      period = resolveReportPeriod({
        period: url.searchParams.get("period") || "month",
        value: url.searchParams.get("value") || "",
        nowMs: options.nowMs,
      }),
      report = await getCreatorBusinessReport(db, creator.id, period);
    if (!report.reconciliation.ok)
      return json(
        {
          error: {
            code: "report_reconciliation_failed",
            message: "This report does not reconcile to the immutable ledger.",
            exceptions: report.reconciliation.exceptions,
          },
        },
        409,
      );
    return new Response(creatorBusinessReportCsv(creator, report), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${creator.slug}-${period.label}-business-report.csv"`,
        "content-type": "text/csv; charset=utf-8",
      },
    });
  } catch (error) {
    return invalid(error.message);
  }
}
async function salesRows(db, creatorId) {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT o.id) order_count,COALESCE(SUM(oi.line_total_cents),0) gross_cents,COUNT(oi.id) units_sold FROM creator_listings cl JOIN order_items oi ON oi.product_slug=cl.source_product_slug JOIN orders o ON o.id=oi.order_id AND o.payment_status='paid' WHERE cl.creator_id=?`,
    )
    .bind(creatorId)
    .first();
  return {
    orderCount: Number(row?.order_count || 0),
    grossCents: Number(row?.gross_cents || 0),
    unitsSold: Number(row?.units_sold || 0),
  };
}
async function bundles(db, creator) {
  return json({
    bundles: await all(
      db
        .prepare(
          "SELECT id,title,description,price_cents,state,created_at,updated_at FROM creator_bundles WHERE creator_id=? ORDER BY updated_at DESC",
        )
        .bind(creator.id),
    ),
  });
}
async function createBundle(request, db, creator) {
  if (creator.permission !== "manager") return forbidden();
  const body = await bodyJson(request),
    title = bounded(body.title, 160),
    ids = list(body.listingIds);
  if (!title || !ids.length || money(body.priceCents) === null)
    return invalid("Bundle title, price, and products are required.");
  const owned = await all(
    db
      .prepare(
        `SELECT id FROM creator_listings WHERE creator_id=? AND id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(creator.id, ...ids),
  );
  if (owned.length !== new Set(ids).size) return forbidden();
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    statements = [
      db
        .prepare(
          "INSERT INTO creator_bundles(id,creator_id,title,description,price_cents,state,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?)",
        )
        .bind(
          id,
          creator.id,
          title,
          bounded(body.description, 2000),
          money(body.priceCents),
          now,
          now,
        ),
      ...ids.map((listingId) =>
        db
          .prepare(
            "INSERT INTO creator_bundle_items(bundle_id,listing_id) VALUES(?,?)",
          )
          .bind(id, listingId),
      ),
    ];
  await db.batch(statements);
  return json({ ok: true, bundle: { id, title, state: "draft" } }, 201);
}

function routePath(request) {
  return (
    new URL(request.url).pathname
      .replace(/^\/api\/creator\/?/, "")
      .replace(/\/$/, "") || "overview"
  );
}
function publicCreator(row) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    profileImage: row.profile_image,
    logo: row.logo,
    bannerImage: row.banner_image,
    shortBio: row.short_bio,
    longBio: row.long_bio,
    profileTemplate: row.profile_template,
    accent: row.accent,
    links: JSON.parse(row.links_json || "[]"),
    profileStatus: row.marketplace_status,
    permission: row.permission,
  };
}
function publicListing(row) {
  const publicSlug = row.catalog_slug || row.public_product_slug || "";
  const discovery = parseDiscovery(row.discovery_json);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    lifecycleState: row.lifecycle_state,
    publicationState: row.publication_state || "not_approved",
    listingVisibility: row.catalog_listing_visibility || "unlisted",
    publicationErrors: JSON.parse(row.publication_errors_json || "[]"),
    reviewNote: row.review_note || "",
    reviewedAt: row.reviewed_at || null,
    revision: Number(row.revision || 1),
    productId: row.catalog_product_id || null,
    productRevision: row.catalog_revision == null ? null : Number(row.catalog_revision),
    catalogPublicationState: row.catalog_publication_state || null,
    priceCents: row.listed_price_cents ?? row.catalog_price_cents ?? null,
    pricingModel: row.pricing_model || "fixed",
    suggestedPriceCents: row.suggested_price_cents ?? null,
    minimumPriceCents: row.minimum_price_cents ?? null,
    shortDescription: row.short_description || "",
    longDescription: row.long_description || "",
    formats: JSON.parse(row.format_json || "[]"),
    gameSystem: row.game_system || "",
    genre: row.genre || "",
    subtitle: discovery.subtitle || "",
    authorCredit: discovery.authorCredit || "",
    publisher: discovery.publisher || "",
    version: discovery.version || "",
    language: discovery.language || "",
    previewOnly: discovery.previewOnly === true,
    salePriceCents: row.sale_price_cents,
    saleStart: row.sale_start,
    saleEnd: row.sale_end,
    mediaType: row.media_type || row.catalog_media_type || "",
    coverImage: Number(row.has_cover_file) === 1
      ? `/api/creator/listings/${encodeURIComponent(row.id)}/cover`
      : row.cover_image || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inactivityState: row.inactivity_state || "active",
    ownerReviewHold: Number(row.owner_review_hold) === 1,
    ownerReviewHoldReason: Number(row.owner_review_hold) === 1 ? row.owner_review_hold_reason : "",
    ownerReviewHoldStartedAt: Number(row.owner_review_hold) === 1 ? row.owner_review_hold_started_at : null,
    ownerReviewHoldCorrectiveActionExpected: Number(row.owner_review_hold) === 1 && Number(row.owner_review_hold_corrective_action_expected) === 1,
    lastQualifyingActivityAt:
      row.last_qualifying_activity_at || row.first_published_at || null,
    inactivityWarningStartedAt: row.inactivity_warning_started_at || null,
    inactivityGraceEndsAt: row.inactivity_grace_ends_at || null,
    inactivityTransitionedAt: row.inactivity_transitioned_at || null,
    publicUrl:
      publicSlug || row.source_product_slug
        ? `/store/products/${publicSlug || row.source_product_slug}/`
        : "",
    discoveryMetadataComplete: Boolean(row.genre && (row.media_type || row.catalog_media_type)),
  };
}
export function requiresPublicationEligibility(method, route) {
  if (method === "GET") return false;
  if (/^listings\/[^/]+\/pause$/.test(route)) return false;
  return route === "listings" || route.startsWith("listings/");
}
export function requiresCurrentEligibility(method, route) {
  if (method === "GET") return false;
  if (
    route === "profile" ||
    route.startsWith("closure") ||
    route.startsWith("remediations/") ||
    /^listings\/[^/]+\/pause$/.test(route)
  )
    return false;
  return route === "bundles" || route === "preferred" || route === "payout-request";
}
function registrationRequired(readiness) {
  const missing = readiness.reasonCodes || [];
  return json(
    {
      error: {
        code: "creator_registration_incomplete",
        message:
          "Current Creator eligibility requirements must be restored before this operation is available.",
        missing,
        remediation: readiness.remediation || [],
      },
    },
    403,
  );
}
function changeCount(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
function listingRevisionConflict(listing) {
  return json(
    {
      error: {
        code: "revision_conflict",
        message: "The listing changed after it was loaded. Refresh before saving again.",
        listing: listing
          ? {
              revision: Number(listing.revision || 0),
              lifecycleState: listing.lifecycle_state || null,
              publicationState: listing.publication_state || null,
            }
          : null,
      },
    },
    409,
  );
}
function safeDiscovery(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = [
    "playerCountMin",
    "playerCountMax",
    "gmMode",
    "prepBurden",
    "playDuration",
    "playMode",
    "rulesComplexity",
    "language",
    "contentDescriptors",
    "subtitle",
    "authorCredit",
    "publisher",
    "version",
    "releaseDate",
  ];
  const result = Object.fromEntries(
    allowed.filter((key) => value[key] !== undefined).map((key) => [
      key,
      ["playerCountMin", "playerCountMax"].includes(key)
        ? Number.isFinite(Number(value[key])) ? Math.max(0, Math.min(100, Math.floor(Number(value[key])))) : null
        : bounded(value[key], key === "subtitle" ? 180 : key === "authorCredit" || key === "publisher" ? 240 : key === "releaseDate" ? 40 : 120),
    ]),
  );
  if (value.language !== undefined) result.language = bounded(value.language, 80);
  if (value.previewOnly !== undefined) result.previewOnly = value.previewOnly === true;
  if (value.contentDescriptors !== undefined) result.contentDescriptors = Array.isArray(value.contentDescriptors)
    ? value.contentDescriptors.map((item) => bounded(item, 120)).filter(Boolean).slice(0, 12)
    : bounded(value.contentDescriptors, 500);
  return result;
}
function parseDiscovery(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function normalizeListingPricing(body, current = null) {
  const previousModel = current?.pricing_model || "fixed";
  const pricingModel = String(body.pricingModel ?? previousModel);
  if (!PRICING_MODELS.has(pricingModel))
    throw new Error("Choose fixed, free, or Pay What You Want pricing.");
  const changedModel = Boolean(current && pricingModel !== previousModel);
  if (pricingModel === "free") {
    return {
      pricingModel,
      priceCents: 0,
      suggestedPriceCents: null,
      minimumPriceCents: null,
    };
  }
  if (pricingModel === "pwyw") {
    const suggestedPriceCents = readMoneyField(
      body,
      "suggestedPriceCents",
      changedModel ? null : current?.suggested_price_cents ?? null,
    );
    const minimumPriceCents = readMoneyField(
      body,
      "minimumPriceCents",
      changedModel ? null : current?.minimum_price_cents ?? null,
    );
    if (
      suggestedPriceCents !== null &&
      minimumPriceCents !== null &&
      suggestedPriceCents < minimumPriceCents
    )
      throw new Error("PWYW suggested price must be at or above its minimum.");
    return {
      pricingModel,
      priceCents: suggestedPriceCents,
      suggestedPriceCents,
      minimumPriceCents,
    };
  }
  const priceCents = readMoneyField(
    body,
    "priceCents",
    changedModel ? null : current?.listed_price_cents ?? null,
  );
  if (priceCents === 0)
    throw new Error("Fixed-price products require a positive price. Choose Free for a zero-price product.");
  return {
    pricingModel,
    priceCents,
    suggestedPriceCents: null,
    minimumPriceCents: null,
  };
}
function readMoneyField(body, key, fallback) {
  if (body[key] === undefined) return fallback;
  const value = money(body[key]);
  if (value === null && body[key] !== null && body[key] !== "")
    throw new Error(`${key} must be a whole, nonnegative number of cents.`);
  return value;
}
async function assertCreatorSubmissionReady(db, listing) {
  const errors = [];
  const formats = JSON.parse(listing.format_json || "[]");
  if (!bounded(listing.title, 160)) errors.push("a title");
  if (!bounded(listing.short_description, 500)) errors.push("a short description");
  if (!bounded(listing.long_description, 10000)) errors.push("a full description");
  if (!MEDIA_TYPES.has(listing.media_type) || !listing.media_type)
    errors.push("a media type");
  if (!formats.length) errors.push("at least one product format");
  if (["digital", "hybrid"].includes(listing.media_type) && !formats.some((value) => String(value).toLowerCase() === "pdf"))
    errors.push("PDF as a product format");
  if (!bounded(listing.game_system, 120)) errors.push("a game system");
  if (!bounded(listing.genre, 80)) errors.push("a genre");
  try {
    const pricing = normalizeListingPricing({}, listing);
    if (pricing.pricingModel === "fixed" && !Number.isInteger(pricing.priceCents))
      errors.push("a fixed price");
    if (
      pricing.pricingModel === "pwyw" &&
      (!Number.isInteger(pricing.minimumPriceCents) ||
        !Number.isInteger(pricing.suggestedPriceCents))
    )
      errors.push("PWYW minimum and suggested prices");
  } catch (error) {
    errors.push(error.message);
  }
  const files = await all(
    db
      .prepare(
        "SELECT purpose,content_type,generated_cover_key FROM creator_listing_files WHERE listing_id=? AND creator_id=? AND validation_state IN ('uploaded','validating','accepted')",
      )
      .bind(listing.id, listing.creator_id),
  );
  if (!files.some((file) => (file.purpose === "cover" && file.content_type === "image/webp") ||
      (file.purpose === "product" && file.content_type === "application/pdf" && file.generated_cover_key)))
    errors.push("a private WebP cover upload");
  if (
    ["digital", "hybrid"].includes(listing.media_type) &&
    !files.some((file) => file.purpose === "product" && file.content_type === "application/pdf")
  )
    errors.push("a private PDF product upload");
  if (errors.length)
    throw new Error(`Complete the listing before review: ${errors.join(", ")}.`);
}
function validLinks(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) return null;
  const result = [];
  for (const entry of value) {
    const label = bounded(entry?.label, 60),
      url = safeUrl(entry?.url);
    if (!label || url === null || !url) return null;
    result.push({ label, url });
  }
  return result;
}
function safeUrl(value) {
  const text = bounded(value, 500);
  if (!text) return "";
  if (text.startsWith("/")) return text;
  try {
    const url = new URL(text);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}
function safeDate(value) {
  const text = String(value || "").trim();
  return !text
    ? null
    : Number.isFinite(Date.parse(text))
      ? new Date(text).toISOString()
      : null;
}
function money(value) {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 100000000
    ? number
    : null;
}
function list(value) {
  return Array.isArray(value)
    ? value
        .map((item) => bounded(item, 100))
        .filter(Boolean)
        .slice(0, 50)
    : [];
}
function bounded(value, max) {
  return String(value || "")
    .trim()
    .slice(0, max);
}
function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
async function all(statement) {
  const result = await statement.all();
  return result.results || [];
}
function forbidden() {
  return json(
    {
      error: {
        code: "creator_access_denied",
        message: "You cannot perform that creator operation.",
      },
    },
    403,
  );
}
function profileShelfError(error) {
  const message = String(error?.message || "Creator Profile shelf could not be updated.");
  if (/capacity|shelf allowance/i.test(message)) {
    return json({ error: { code: "profile_shelf_capacity", message } }, 409);
  }
  if (/authenticated owner|do not belong to this Creator/i.test(message)) {
    return json({ error: { code: "creator_access_denied", message } }, 403);
  }
  return invalid(message);
}
function invalid(message) {
  return json({ error: { code: "invalid_creator_input", message } }, 400);
}
function notFound() {
  return json(
    { error: { code: "listing_not_found", message: "Listing not found." } },
    404,
  );
}
function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": "private, no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
