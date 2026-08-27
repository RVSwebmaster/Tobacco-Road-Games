import {handleCreatorRegistrationRequest} from '../_lib/creator-registration.mjs';export function onRequest(context){return handleCreatorRegistrationRequest(context.request,context.env);}
