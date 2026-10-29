import {customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {initialConditionClasses} from './catalog-options.ts';
import {calculateQuote,QuotePricingError} from './quote-pricing.ts';
import type {QuoteDiscount,QuotePriceLine} from './quote-pricing.ts';

export type QuoteRecipient=Readonly<{customerId:string|null;leadId:string|null;displayName:string;phone:string|null;email:string|null}>;
export type QuoteContentLine=QuotePriceLine&Readonly<{vehicleId:string|null;jobWide:boolean;vehicleLabel:string|null;serviceVersionId:string|null;description:string;inclusions:string;exclusions:string;condition:typeof initialConditionClasses[number]|null}>;
export type QuoteContentInput=Readonly<{schemaVersion:1;title:string;recipient:QuoteRecipient;workLocation:string;terms:string;timezone:string;expiryAt:string|null;proposedSchedule:string|null;internalNotes:string|null;documentDiscount:QuoteDiscount|null;lines:readonly QuoteContentLine[]}>;
export class QuoteContentError extends Error{readonly code:string;constructor(code:string){super(code);this.name='QuoteContentError';this.code=code;}}
const fail=(code:string):never=>{throw new QuoteContentError(code);};
function text(value:unknown,limit:number,required=false,multiline=false):value is string{
 return typeof value==='string'&&[...value].length<=limit&&(!required||value.trim().length>0)&&[...value].every(character=>{const n=character.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||multiline&&(n===9||n===10||n===13));});
}
const optional=(value:unknown,limit:number,multiline=false):value is string|null=>value===null||text(value,limit,true,multiline);
const identifier=(value:unknown):value is string=>customerUuid(value)&&value===value.trim();
const optionalId=(value:unknown):value is string|null=>value===null||identifier(value);
const discountCopy=(value:QuoteDiscount|null):QuoteDiscount|null=>value===null?null:Object.freeze(value.kind==='fixed'?{kind:'fixed',cents:value.cents}:{kind:'percent',rate:value.rate});
const lineKeys=['id','vehicleId','jobWide','vehicleLabel','serviceVersionId','description','inclusions','exclusions','condition','grossCents','lineDiscount','documentDiscountEligible','complimentaryReason'] as const;
export function parseQuoteContentLine(row:unknown):QuoteContentLine{
 if(!exact(row,lineKeys)||!identifier(row.id)||!optionalId(row.vehicleId)||typeof row.jobWide!=='boolean'||!optionalId(row.serviceVersionId)
  ||!text(row.description,200,true)||!text(row.inclusions,8000,false,true)||!text(row.exclusions,8000,false,true)
  ||!(row.condition===null||initialConditionClasses.includes(row.condition as typeof initialConditionClasses[number])))return fail('line');
 if(row.vehicleId===null?!row.jobWide||row.vehicleLabel!==null:row.jobWide||!text(row.vehicleLabel,500,true))return fail('scope');
 let price:ReturnType<typeof calculateQuote>['lines'][number];
 try{price=calculateQuote([{id:row.id,grossCents:row.grossCents,lineDiscount:row.lineDiscount,documentDiscountEligible:row.documentDiscountEligible,complimentaryReason:row.complimentaryReason} as QuotePriceLine],null).lines[0]!;}
 catch(error){return fail(error instanceof QuotePricingError?error.code:'pricing');}
 return Object.freeze({id:row.id,vehicleId:row.vehicleId,jobWide:row.jobWide,vehicleLabel:row.vehicleLabel as string|null,serviceVersionId:row.serviceVersionId,
  description:row.description,inclusions:row.inclusions,exclusions:row.exclusions,condition:row.condition as QuoteContentLine['condition'],grossCents:price.grossCents,
  lineDiscount:discountCopy(row.lineDiscount as QuoteDiscount|null),documentDiscountEligible:price.documentDiscountEligible,complimentaryReason:price.complimentaryReason});
}

/** BR04/05 complete review content, not a save, approval or sent offer.
 * Referential ownership/current versions must still be verified in the trusted
 * database transaction. No browser total, catalog guidance or tax is accepted.
 * Fixed property order and decimal strings define content serialization v1.
 */
export function prepareQuoteContent(value:unknown){
 if(!exact(value,['schemaVersion','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','internalNotes','documentDiscount','lines'])||value.schemaVersion!==1
  ||!text(value.title,200,true)||!text(value.workLocation,4000,true,true)||!text(value.terms,8000,false,true)||!text(value.timezone,100,true)
  ||!(value.expiryAt===null||customerInstant(value.expiryAt))||!optional(value.proposedSchedule,2000,true)||!optional(value.internalNotes,8000,true))return fail('content');
 try{new Intl.DateTimeFormat('en-US',{timeZone:value.timezone}).format(0);}catch{return fail('timezone');}
 const recipient=value.recipient;
 if(!exact(recipient,['customerId','leadId','displayName','phone','email'])||!optionalId(recipient.customerId)||!optionalId(recipient.leadId)||recipient.customerId===null&&recipient.leadId===null
  ||!text(recipient.displayName,200,true)||!optional(recipient.phone,512)||!optional(recipient.email,512))return fail('recipient');
 if(!Array.isArray(value.lines)||value.lines.length===0||value.lines.length>1000)return fail('lines');
 const rows=value.lines.map(parseQuoteContentLine);
 let pricing:ReturnType<typeof calculateQuote>;
 try{pricing=calculateQuote(rows.map(row=>({id:row.id,grossCents:row.grossCents,lineDiscount:row.lineDiscount,documentDiscountEligible:row.documentDiscountEligible,complimentaryReason:row.complimentaryReason})) as QuotePriceLine[],value.documentDiscount as QuoteDiscount|null);}
 catch(error){return fail(error instanceof QuotePricingError?error.code:'pricing');}
 // Only these explicit fields can enter the customer representation. Source IDs,
 // internal notes and future private fields are never copied with object spread.
 const customer=Object.freeze({schemaVersion:1 as const,currency:'USD' as const,title:value.title,
  recipient:Object.freeze({displayName:recipient.displayName,phone:recipient.phone,email:recipient.email}),workLocation:value.workLocation,terms:value.terms,timezone:value.timezone,expiryAt:value.expiryAt,proposedSchedule:value.proposedSchedule,
  lines:Object.freeze(rows.map((row,index)=>{const price=pricing.lines[index]!;return Object.freeze({description:row.description,inclusions:row.inclusions,exclusions:row.exclusions,vehicle:row.vehicleLabel,condition:row.condition,
   grossCents:price.grossCents,lineDiscount:discountCopy(row.lineDiscount as QuoteDiscount|null),lineDiscountCents:price.lineDiscountCents,documentDiscountEligible:price.documentDiscountEligible,allocatedDiscountCents:price.allocatedDiscountCents,finalCents:price.finalCents,complimentaryReason:price.complimentaryReason});})),
  documentDiscount:discountCopy(value.documentDiscount as QuoteDiscount|null),grossCents:pricing.grossCents,lineDiscountCents:pricing.lineDiscountCents,documentDiscountCents:pricing.documentDiscountCents,totalCents:pricing.totalCents});
 const internal=Object.freeze({customerId:recipient.customerId,leadId:recipient.leadId,notes:value.internalNotes,
  sources:Object.freeze(rows.map(row=>Object.freeze({stableLineKey:row.id,vehicleId:row.vehicleId,jobWide:row.jobWide,serviceVersionId:row.serviceVersionId}))),
  extremeReviewRequired:rows.some(row=>row.condition==='Extreme')});
 return Object.freeze({customer,internal,canonical:JSON.stringify({schemaVersion:1,customer,internal})});
}
