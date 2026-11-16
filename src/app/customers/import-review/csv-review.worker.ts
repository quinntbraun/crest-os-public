import {inspectLegacyContactFile,LegacyContactImportError,previewLegacyContacts} from '../../../customer/legacy-contact-import-preview';
import {browserCsvReview} from './csv-review-protocol';
import type {LegacyCsvRequest,LegacyCsvResponse} from './csv-review-protocol';

const scope=self as unknown as {onmessage:((message:MessageEvent<LegacyCsvRequest>)=>void)|null;postMessage:(reply:LegacyCsvResponse)=>void};
let bytes:Uint8Array|undefined;

scope.onmessage=async({data})=>{
 try{
  if(data.kind==='open'){
   const candidate=new Uint8Array(await data.file.arrayBuffer());
   const source=inspectLegacyContactFile(candidate);
   bytes=candidate;
   scope.postMessage({kind:'open',source});
   return;
  }
  if(!bytes)throw new Error();
  const review=await previewLegacyContacts(bytes,data.mapping,data.businessId);
  scope.postMessage({kind:'review',review:browserCsvReview(review)});
 }catch(error){
  scope.postMessage({kind:'error',message:error instanceof LegacyContactImportError?error.message:'LEGACY_CSV_READ_FAILED'});
 }
};
