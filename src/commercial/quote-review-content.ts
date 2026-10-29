import {customerInstant,customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {initialConditionClasses,initialVehicleCategories} from './catalog-options.ts';
import {prepareQuoteContent,parseQuoteContentLine,QuoteContentError} from './quote-content.ts';
import type {QuoteContentInput,QuoteContentLine} from './quote-content.ts';

export type QuoteAssessment=Readonly<{id:string;class:typeof initialConditionClasses[number];source:'reported'|'photo'|'on_site';assessedAt:string;notes:string|null}>;
export type QuoteReviewLine=QuoteContentLine&Readonly<{category:typeof initialVehicleCategories[number]|null;assessment:QuoteAssessment|null;categoryOverrideNote:string|null}>;
export type QuoteReviewContentInput=Omit<QuoteContentInput,'schemaVersion'|'lines'>&Readonly<{schemaVersion:2;lines:readonly QuoteReviewLine[]}>;
export type VersionedQuoteContentInput=QuoteContentInput|QuoteReviewContentInput;
const lineKeys=['id','vehicleId','jobWide','vehicleLabel','serviceVersionId','description','inclusions','exclusions','condition','grossCents','lineDiscount','documentDiscountEligible','complimentaryReason','category','assessment','categoryOverrideNote'] as const;
const rootKeys=['schemaVersion','title','recipient','workLocation','terms','timezone','expiryAt','proposedSchedule','internalNotes','documentDiscount','lines'] as const;
const fail=(code:string):never=>{throw new QuoteContentError(code);};
function note(value:unknown):value is string|null{
 return value===null||typeof value==='string'&&value.trim().length>0&&[...value].length<=8000&&[...value].every(c=>{const n=c.codePointAt(0)!;return !(n>=0xd800&&n<=0xdfff)&&(!(n<32||n===127)||n===9||n===10||n===13);});
}
export function parseQuoteAssessment(value:unknown):QuoteAssessment|null{
 if(value===null)return null;
 if(!exact(value,['id','class','source','assessedAt','notes'])||!customerUuid(value.id)||value.id!==value.id.trim()
  ||!initialConditionClasses.includes(value.class as QuoteAssessment['class'])||!['reported','photo','on_site'].includes(value.source as string)
  ||typeof value.assessedAt!=='string'||value.assessedAt.length!==27||!customerInstant(value.assessedAt)||!note(value.notes))return fail('assessment');
 return Object.freeze({id:value.id,class:value.class as QuoteAssessment['class'],source:value.source as QuoteAssessment['source'],assessedAt:value.assessedAt,notes:value.notes});
}
export function parseQuoteReviewLine(value:unknown):QuoteReviewLine{
 if(!exact(value,lineKeys)||!(value.category===null||initialVehicleCategories.includes(value.category as typeof initialVehicleCategories[number]))||!note(value.categoryOverrideNote))return fail('assessment');
 const line=parseQuoteContentLine({id:value.id,vehicleId:value.vehicleId,jobWide:value.jobWide,vehicleLabel:value.vehicleLabel,serviceVersionId:value.serviceVersionId,description:value.description,inclusions:value.inclusions,exclusions:value.exclusions,condition:value.condition,grossCents:value.grossCents,lineDiscount:value.lineDiscount,documentDiscountEligible:value.documentDiscountEligible,complimentaryReason:value.complimentaryReason});
 const assessment=parseQuoteAssessment(value.assessment);
 if(assessment!==null&&(line.vehicleId===null||line.condition!==assessment.class)||line.jobWide&&(value.category!==null||assessment!==null||value.categoryOverrideNote!==null))return fail('assessment');
 return Object.freeze({...line,category:value.category as QuoteReviewLine['category'],assessment,categoryOverrideNote:value.categoryOverrideNote});
}

/** Forward content version: assessment provenance is sealed alongside the
 * offered scope. Version1 serialization is never upgraded or rewritten here.
 * Missing facts are permitted in Draft; review requires explicit completion.
 */
export function prepareQuoteReviewContent(value:unknown){
 if(!exact(value,rootKeys)||value.schemaVersion!==2||!Array.isArray(value.lines))return fail('content');
 const lines=value.lines.map(parseQuoteReviewLine),seen=new Map<string,string>();
 for(const line of lines)if(line.assessment!==null){
  const identity=JSON.stringify({vehicleId:line.vehicleId,...line.assessment}),previous=seen.get(line.assessment.id);
  if(previous!==undefined&&previous!==identity)return fail('assessment');seen.set(line.assessment.id,identity);
 }
 // Name every v1 input explicitly: additional caller properties never enter
 // the customer-safe projection, even through an accidental spread.
 const original=prepareQuoteContent({schemaVersion:1,title:value.title,recipient:value.recipient,workLocation:value.workLocation,terms:value.terms,timezone:value.timezone,expiryAt:value.expiryAt,proposedSchedule:value.proposedSchedule,internalNotes:value.internalNotes,documentDiscount:value.documentDiscount,lines:lines.map(line=>({id:line.id,vehicleId:line.vehicleId,jobWide:line.jobWide,vehicleLabel:line.vehicleLabel,serviceVersionId:line.serviceVersionId,description:line.description,inclusions:line.inclusions,exclusions:line.exclusions,condition:line.condition,grossCents:line.grossCents,lineDiscount:line.lineDiscount,documentDiscountEligible:line.documentDiscountEligible,complimentaryReason:line.complimentaryReason}))});
 const customer=Object.freeze({...original.customer,schemaVersion:2 as const,lines:Object.freeze(original.customer.lines.map((line,index)=>Object.freeze({description:line.description,inclusions:line.inclusions,exclusions:line.exclusions,vehicle:line.vehicle,condition:line.condition,category:lines[index]!.category,grossCents:line.grossCents,lineDiscount:line.lineDiscount,lineDiscountCents:line.lineDiscountCents,documentDiscountEligible:line.documentDiscountEligible,allocatedDiscountCents:line.allocatedDiscountCents,finalCents:line.finalCents,complimentaryReason:line.complimentaryReason})))});
 const internal=Object.freeze({...original.internal,sources:Object.freeze(original.internal.sources.map((source,index)=>Object.freeze({...source,assessment:lines[index]!.assessment,categoryOverrideNote:lines[index]!.categoryOverrideNote})))});
 return Object.freeze({customer,internal,canonical:JSON.stringify({schemaVersion:2,customer,internal})});
}
export function prepareVersionedQuoteContent(value:unknown){
 return value&&typeof value==='object'&&'schemaVersion' in value&&value.schemaVersion===2?prepareQuoteReviewContent(value):prepareQuoteContent(value);
}
/** This is preparation feedback, not permission to approve or a saved state. */
export function quoteReviewReadiness(value:unknown):string|null{
 const prepared=prepareQuoteReviewContent(value);
 for(let index=0;index<prepared.customer.lines.length;index++){
  const line=prepared.customer.lines[index]!,source=prepared.internal.sources[index]!;
  if(source.jobWide){if(line.condition!==null)return 'Remove the vehicle condition from job-wide line '+(index+1)+'.';}
  else if(line.category===null||line.condition===null||source.assessment===null)return 'Record the vehicle category, condition, observation source and assessment time for line '+(index+1)+'.';
 }
 return null;
}
