import {LegacyContactImportError,previewLegacyContacts} from './legacy-contact-import-preview.ts';
import type {LegacyContactColumnMap} from './legacy-contact-import-preview.ts';

export async function prepareLegacyContactBatch(file:Uint8Array,mapping:LegacyContactColumnMap,businessId:string,sourceLabel:string){
 if(typeof sourceLabel!=='string'||!sourceLabel||sourceLabel!==sourceLabel.trim()||
   [...sourceLabel].length>160||/[\p{Cc}\p{Cs}]/u.test(sourceLabel)){
  throw new LegacyContactImportError('LEGACY_IMPORT_SOURCE_LABEL_REQUIRED');
 }
 const review=await previewLegacyContacts(file,mapping,businessId);
 if(!review.sourceRowCount)throw new LegacyContactImportError('LEGACY_IMPORT_EMPTY_BATCH');
 const rowData=new Map(review.rows.map(row=>[row.row,row]));
 const rowIssues=new Map<number,string[]>();
 for(const {row,reason} of review.issues){
  const issues=rowIssues.get(row)??[];
  issues.push(reason);
  rowIssues.set(row,issues);
 }
 const candidates=Array.from({length:review.sourceRowCount},(_,index)=>{
  const sourceRow=index+2,record=rowData.get(sourceRow),issues=rowIssues.get(sourceRow)??[];
  if(!record)return {customer:null,vehicle:null,issues};
  const {displayName,phone,email,customerSince,outreachOptOut,notes}=record.customer;
  const customer={sourceId:record.customerSourceId,displayName,phone,email,customerSince,outreachOptOut,notes};
  if(!record.vehicle)return {customer,vehicle:null,issues};
  const {label,year,make,model,color,vin,plate}=record.vehicle.draft;
  return {customer,vehicle:{sourceId:record.vehicle.sourceId,label,year,make,model,color,vin,plate},issues};
 });
 return {sourceLabel,originalSha256:review.sourceSha256,mapping:review.mapping,candidates};
}
