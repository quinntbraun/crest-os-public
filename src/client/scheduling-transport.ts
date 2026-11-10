import type {Proof} from './authentication';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
const routes=['slot-review','original','workspace','agreement','resources','pending','list','read','history','mode-history','mode-save','book','cancel','reschedule','field-save','completion-context','complete','mileage-trips','mileage-history','mileage-save','support-trips','support-trip-history','support-trip-mileage','support-trip-save','interrupt','unfulfilled-context','cancel-unfulfilled','work-time','work-boundary-save','work-start','work-start-save','work-end','work-end-save','mobile-departure','mobile-departure-save','review-outcome','review-outcome-save'] as const;
export type SchedulingRoute=typeof routes[number];
type Kind='input'|'not_submitted'|'recovery'|'limited'|'unknown'|'unavailable';
export class SchedulingClientError extends Error{readonly kind:Kind;constructor(kind:Kind){super('SCHEDULING_REQUEST_FAILED');this.name='SchedulingClientError';this.kind=kind;}}
// Domain-only private transport. No retries, storage, auth bypass or external URL.
export async function postScheduling(route:SchedulingRoute,body:object,proof:Proof,external:AbortSignal){
 const mutation=['book','cancel','reschedule','mode-save','field-save','complete','mileage-save','support-trip-save','interrupt','cancel-unfulfilled','work-boundary-save','work-start-save','work-end-save','mobile-departure-save','review-outcome-save'].includes(route);let sent=false;
 try{
  if(!routes.includes(route)||typeof proof?.csrfToken!=='string'||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(proof.csrfToken)||!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=Date.now())throw Error();
  const signal=AbortSignal.any([external,AbortSignal.timeout(40000)]),encoded=JSON.stringify(body);if(signal.aborted||new TextEncoder().encode(encoded).length>(mutation?131072:16384))throw Error();sent=true;
  const response=await fetch('/api/business/scheduling/'+route,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:encoded,signal});
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers.get('content-type')??'')||!response.headers.get('cache-control')?.includes('no-store'))throw Error();
  const reader=response.body?.getReader();if(!reader)throw Error();let size=0;const parts:Uint8Array[]=[];const limit=route==='agreement'||route==='resources'||route==='mileage-history'?4194304:1048576;
  try{for(;;){const part=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const abort=()=>reject(Error());if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});if(part.done)break;if(!(part.value instanceof Uint8Array)||part.value.byteLength===0||(size+=part.value.byteLength)>limit)throw Error();parts.push(part.value);}}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  if(signal.aborted)throw Error();const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),value:unknown=JSON.parse(text),nodes:{value:unknown;depth:number}[]=[{value,depth:0}];let fields=0,visited=0;
  // A field recovery receipt can contain 10,000 opaque audit references plus
  // its binding envelope. Keep the same bounded node budget as other reads;
  // the 1 MiB original-response limit and strict domain parser remain intact.
  const nodeLimit=route==='mileage-history'?300000:20000;
  while(nodes.length){const node=nodes.pop()!;if(++visited>nodeLimit||node.depth>32)throw Error();if(node.value&&typeof node.value==='object'){if(!Array.isArray(node.value))fields+=Object.keys(node.value).length;nodes.push(...Object.values(node.value).map(v=>({value:v,depth:node.depth+1})));}}
  if((text.match(/"(?:[^"\\]|\\.)*"|:/g)??[]).filter(t=>t===':').length!==fields)throw Error();
  if(exact(value,['error'])){
   if(value.error==='SCHEDULING_REQUEST_LIMITED'&&response.status===429)throw new SchedulingClientError('limited');
   if(mutation&&value.error==='SCHEDULING_SAVE_NOT_SUBMITTED'&&response.status===503)throw new SchedulingClientError('not_submitted');
   if(mutation&&value.error==='RECOVERY_REVIEW_REQUIRED'&&response.status===409)throw new SchedulingClientError('recovery');
   if(mutation&&value.error==='SCHEDULING_SAVE_OUTCOME_UNKNOWN'&&response.status===503)throw new SchedulingClientError('unknown');throw Error();
  }
  return {value,status:response.status,binding:response.headers.get('x-crest-edit-binding'),
   ...route==='workspace'&&response.headers.get('x-crest-amended-scheduling')==='1'?{amendedSchedulingAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-field-session')==='1'?{fieldSessionAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-job-completion')==='1'?{jobCompletionAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-job-mileage')==='1'?{jobMileageAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-support-trips')==='1'?{supportTripsAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-unfulfilled-cancellation')==='1'?{unfulfilledCancellationAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-work-time')==='1'?{workTimeAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-work-start')==='1'?{workStartAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-work-end')==='1'?{workEndAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-mobile-departure')==='1'?{mobileDepartureAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-review-outcome')==='1'?{reviewOutcomeAvailable:true as const}:{},
   ...route==='workspace'&&response.headers.get('x-crest-work-boundary')==='1'?{workBoundaryAvailable:true as const}:{}};
 }catch(error){throw error instanceof SchedulingClientError?error:new SchedulingClientError(mutation?(sent?'unknown':'not_submitted'):'unavailable');}
}
