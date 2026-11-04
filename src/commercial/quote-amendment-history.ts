// Saved, version-pinned record retrieval. Not a snapshot/export authority.
import {parseQuoteAmendmentRead,quoteAmendmentReadToWire} from './quote-amendment-read';
import type {QuoteAmendmentRead,QuoteAmendmentReadRequest} from './quote-amendment-read';
export type SavedQuoteAmendment=Exclude<QuoteAmendmentRead,{state:'absent'}>;
export class QuoteAmendmentHistoryError extends Error{constructor(){super('QUOTE_AMENDMENT_HISTORY_REVIEW_REQUIRED');this.name='QuoteAmendmentHistoryError';}}
const check=(value:unknown)=>{if(!value)throw new QuoteAmendmentHistoryError();};
function same(a:unknown,b:unknown):boolean{if(a===b)return true;if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));}
/** Every mutable read observation must still match; history alone is append-only.
 * This comparison is not a claim of a database export snapshot. */
export function sameAmendmentSource(a:SavedQuoteAmendment,b:SavedQuoteAmendment){const aw=quoteAmendmentReadToWire(a),bw=quoteAmendmentReadToWire(b);if('state'in aw||'state'in bw)return false;const {history:ah,hasMore:am,...left}=aw,{history:bh,hasMore:bm,...right}=bw;void ah;void am;void bh;void bm;return same(left,right);}
type Event=SavedQuoteAmendment['history'][number];
export async function pinAmendmentRead(value:SavedQuoteAmendment):Promise<SavedQuoteAmendment>{
 try{const first=value.history[0]?.revision,request={businessId:value.businessId,familyId:value.family.id,revisionId:value.revision.id,afterVersion:first?(BigInt(first)-1n).toString():value.revision.version,pageSize:5},result=await parseQuoteAmendmentRead(quoteAmendmentReadToWire(value),request);if('state'in result)throw Error();return result;}catch{throw new QuoteAmendmentHistoryError();}
}
export async function checkedAmendmentHistoryPage(value:QuoteAmendmentRead,request:QuoteAmendmentReadRequest,expected:SavedQuoteAmendment,predecessor:Event|null=null):Promise<SavedQuoteAmendment>{
 try{
  const page=await parseQuoteAmendmentRead(quoteAmendmentReadToWire(value),request);check(!('state'in page));if('state'in page)throw Error();check(sameAmendmentSource(page,expected));
  if(request.afterVersion!=='0'){check(predecessor?.revision===request.afterVersion);if(page.history.length)check(same(page.history[0]!.before,predecessor!.after));}
  const seen=new Map<string,string>();for(const event of page.history){for(const row of [event.before,event.after]){if(!row)continue;const found=seen.get(row.canonical_content);if(found!==undefined){check(found===row.content_hash);continue;}const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(row.canonical_content)),hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');check(hash===row.content_hash);seen.set(row.canonical_content,hash);}}
  return page;
 }catch{throw new QuoteAmendmentHistoryError();}
}
export const amendmentRecordVersionLimit=1000,amendmentRecordByteLimit=8*1024*1024;
/** Retrieve the complete immutable event prefix bound to one current saved
 * source. No retries, truncation, cached body or background delivery. */
export async function collectAmendmentHistory(expected:SavedQuoteAmendment,read:(request:QuoteAmendmentReadRequest)=>Promise<QuoteAmendmentRead>,signal:AbortSignal){
 try{
  check(!signal.aborted&&BigInt(expected.revision.version)<=BigInt(amendmentRecordVersionLimit));expected=await pinAmendmentRead(expected);check(!signal.aborted);let cursor='0',last:Event|null=null,size=0;const events:Event[]=[],ids=new Set<string>();
  for(let pageNo=0;pageNo<amendmentRecordVersionLimit/5;pageNo++){
   check(!signal.aborted);const request={businessId:expected.businessId,familyId:expected.family.id,revisionId:expected.revision.id,afterVersion:cursor,pageSize:5},page=await checkedAmendmentHistoryPage(await read(request),request,expected,last);check(!signal.aborted);
   for(const event of page.history){check(!ids.has(event.eventId));ids.add(event.eventId);size+=new TextEncoder().encode(JSON.stringify(event)).byteLength;check(size<=amendmentRecordByteLimit);events.push(event);last=event;}
   if(!page.hasMore){check(BigInt(events.length)===BigInt(expected.revision.version)&&last!==null&&same(last.after,expected.revision));return Object.freeze(events);}
   check(last!==null&&last.revision!==cursor);cursor=last!.revision;
  }
  throw Error();
 }catch{throw new QuoteAmendmentHistoryError();}
}
