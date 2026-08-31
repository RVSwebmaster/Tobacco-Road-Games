import {requestGuestEmailVerification} from '../../_lib/guest-email-verification.mjs';
export function onRequestPost(context){return requestGuestEmailVerification(context.request,context.env);}
