import {handleCreatorFinanceOwnerRequest} from '../../_lib/creator-finance-owner.mjs';
export function onRequestGet(context){return handleCreatorFinanceOwnerRequest(context.request,context.env);}
export function onRequestPost(context){return handleCreatorFinanceOwnerRequest(context.request,context.env);}
