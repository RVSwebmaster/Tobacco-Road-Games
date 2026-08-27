import {handleAdvertisingOwner} from '../../_lib/advertising-owner.mjs';export function onRequest(context){return handleAdvertisingOwner(context.request,context.env);}
