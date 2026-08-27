import {handleCreatorAdvertisingRequest} from '../../_lib/creator-advertising-route.mjs';
export function onRequest(context){return handleCreatorAdvertisingRequest(context.request,context.env);}
