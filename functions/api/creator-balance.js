import { handleCreatorBalanceRequest } from "../_lib/creator-balance-route.mjs";

export const onRequest = (context) => handleCreatorBalanceRequest(context.request, context.env);
