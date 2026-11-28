import { handleCustomerPaymentMethods } from "../../_lib/customer-payment-methods.mjs";
export function onRequest(context) { return handleCustomerPaymentMethods(context.request, context.env); }
