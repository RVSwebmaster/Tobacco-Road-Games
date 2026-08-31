import {confirmGuestEmailVerification} from '../../_lib/guest-email-verification.mjs';
export function onRequestPost(context){return confirmGuestEmailVerification(context.request,context.env);}
