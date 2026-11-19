import { handleCustomerPaymentMethodsRequest } from "../../_lib/customer-payment-methods.mjs";

export function onRequest(context) {
  return handleCustomerPaymentMethodsRequest(context.request, context.env);
}
