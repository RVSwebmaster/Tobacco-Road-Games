import {handleAccountProfileRequest} from '../../_lib/account-profile.mjs';export function onRequest(context){return handleAccountProfileRequest(context.request,context.env);}
