import {parseServicePayload,serviceContentDefinition} from '../commercial/service-storage-contract';
import type {ServicePayload,StoredService,StoredServiceContent} from '../commercial/service-storage-contract';
import {serviceDurationInput} from '../commercial/service-catalog';
import {quoteDollarsInput} from '../commercial/quote-pricing';

export type ServiceDraft=Readonly<{code:string;active:boolean;name:string;inclusions:string;exclusions:string;internalGuidance:string;low:string;high:string;minutes:string;seconds:string}>;
export const emptyServiceDraft:ServiceDraft=Object.freeze({code:'',active:true,name:'',inclusions:'',exclusions:'',internalGuidance:'',low:'',high:'',minutes:'',seconds:''});
const dollars=(cents:string|null)=>cents===null?'':`${BigInt(cents)/100n}.${(BigInt(cents)%100n).toString().padStart(2,'0')}`;
export function draftFromService(service:StoredService,content:StoredServiceContent):ServiceDraft{
 const d=serviceContentDefinition(content),duration=d.estimatedSeconds===null?null:BigInt(d.estimatedSeconds);
 return Object.freeze({code:service.code,active:service.active,name:d.name,inclusions:d.inclusions,exclusions:d.exclusions,internalGuidance:d.internalGuidance??'',low:dollars(d.rangeLowCents),high:dollars(d.rangeHighCents),minutes:duration===null?'':String(duration/60n),seconds:duration===null?'':String(duration%60n)});
}
export function parseServiceDraft(draft:ServiceDraft):ServicePayload{
 return parseServicePayload({code:draft.code,active:draft.active,definition:{name:draft.name,inclusions:draft.inclusions,exclusions:draft.exclusions,internalGuidance:draft.internalGuidance===''?null:draft.internalGuidance,rangeLowCents:draft.low.trim()===''?null:quoteDollarsInput(draft.low),rangeHighCents:draft.high.trim()===''?null:quoteDollarsInput(draft.high),estimatedSeconds:serviceDurationInput(draft.minutes,draft.seconds)}});
}
// Compare normalized domain values, so formatting-only edits do not create an
// operation reference for the server's deliberately receipt-free no-op result.
export function serviceDraftChanged(draft:ServiceDraft|null,original:ServiceDraft):boolean{
 if(draft===null)return false;try{return JSON.stringify(parseServiceDraft(draft))!==JSON.stringify(parseServiceDraft(original));}catch{return JSON.stringify(draft)!==JSON.stringify(original);}
}
