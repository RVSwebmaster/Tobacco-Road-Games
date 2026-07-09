export function onRequestPost() {
  return new Response(JSON.stringify({
    error: "This temporary pending-order endpoint has been disabled. Use /api/cart/checkout instead."
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    status: 410
  });
}
