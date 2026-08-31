import { verifyOrderAccessToken } from "../_lib/order-access.mjs";
import { chooseRemediation } from "../_lib/marketplace-operations.mjs";

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request))
    return json(
      { error: "The remediation request could not be verified." },
      403,
    );
  let body = {};
  try {
    body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : Object.fromEntries(await request.formData());
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  try {
    const access = await verifyOrderAccessToken(
      env.TRG_ORDERS,
      body.credential,
      env.ORDER_ACCESS_SIGNING_SECRET,
    );
    const order = await env.TRG_ORDERS.prepare(
      "SELECT id,user_id,customer_email_hash FROM orders WHERE id=?",
    )
      .bind(access.order_id)
      .first();
    const result = await chooseRemediation(env.TRG_ORDERS, {
      caseId: body.caseId,
      orderId: order.id,
      userId: order.user_id,
      emailHash: order.customer_email_hash,
      choice: body.choice,
    });
    if (!request.headers.get("content-type")?.includes("application/json"))
      return new Response(
        `<!doctype html><title>Choice recorded | Tobacco Road Games</title><link rel="stylesheet" href="/styles.css"><main class="store-section statement-page"><h1>Choice recorded</h1><p>${result.choice === "refund" ? "Your refund is queued for operator processing." : "Your existing entitlement remains active while you wait for the accepted correction."}</p><p><a class="button" href="/store/order-access?credential=${encodeURIComponent(body.credential)}">Return to order</a></p></main>`,
        {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/html; charset=utf-8",
          },
        },
      );
    return json({ ok: true, ...result });
  } catch (error) {
    return json(
      { error: error.message || "Order access could not be verified." },
      403,
    );
  }
}
function sameOrigin(r) {
  const o = r.headers.get("origin");
  if (!o) return false;
  try {
    return new URL(o).origin === new URL(r.url).origin;
  } catch {
    return false;
  }
}
function json(v, s = 200) {
  return new Response(JSON.stringify(v), {
    status: s,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
