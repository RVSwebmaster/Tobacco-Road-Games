import{handleCreatorPublicationRequest}from"../../_lib/creator-publication.mjs";export function onRequestPost(context){return handleCreatorPublicationRequest(context.request,context.env);}
