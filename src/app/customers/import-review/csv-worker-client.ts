import {LegacyContactImportError} from '../../../customer/legacy-contact-import-preview';
import type {LegacyCsvRequest,LegacyCsvResponse} from './csv-review-protocol';

export function askCsvWorker(worker:Worker,request:LegacyCsvRequest,signal:AbortSignal){
 return new Promise<Exclude<LegacyCsvResponse,{kind:'error'}>>((resolve,reject)=>{
  function cleanUp(){
   signal.removeEventListener('abort',fail);
   worker.removeEventListener('error',fail);
   worker.removeEventListener('messageerror',fail);
   worker.removeEventListener('message',receive);
  }
  function fail(){
   cleanUp();
   reject(new LegacyContactImportError('LEGACY_CSV_READ_FAILED'));
  }
  function receive(event:MessageEvent<LegacyCsvResponse>){
   cleanUp();
   const response=event.data;
   if(response.kind==='error')reject(new LegacyContactImportError(response.message));
   else if(response.kind===request.kind)resolve(response);
   else reject(new LegacyContactImportError('LEGACY_CSV_READ_FAILED'));
  }
  if(signal.aborted){fail();return;}
  signal.addEventListener('abort',fail,{once:true});
  worker.addEventListener('error',fail,{once:true});
  worker.addEventListener('messageerror',fail,{once:true});
  worker.addEventListener('message',receive,{once:true});
  try{worker.postMessage(request);}catch{fail();}
 });
}
