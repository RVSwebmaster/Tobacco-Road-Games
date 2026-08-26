import {handleCreatorConnectRequest} from '../../_lib/creator-connect.mjs';
export function onRequestPost(context){return handleCreatorConnectRequest(context.request,context.env);}
