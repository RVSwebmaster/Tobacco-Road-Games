import {handleCreatorFileUpload} from "../../../../_lib/creator-files.mjs";
export function onRequestPost(context){return handleCreatorFileUpload(context.request,context.env,context.params.id);}
