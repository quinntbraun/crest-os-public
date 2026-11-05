// Owner-only source formatting. This cannot establish collection authority,
// snapshot origin/completeness, external-reference closure or recovery custody.
import {createHash} from 'node:crypto';
import {exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {calculateQuote} from './quote-pricing.ts';
import {quoteId,quoteVersion,quoteFamilyColumns,quoteRevisionColumns,quoteItemColumns,parseStoredQuoteFamily,parseStoredQuoteRevision,parseStoredQuoteItem,requireQuoteStorage as check} from './quote-storage-contract.ts';
import type {StoredQuoteFamily,StoredQuoteRevision,StoredQuoteItem} from './quote-storage-contract.ts';

export type QuoteDraftSourceInput=Readonly<{businessId:string;snapshotToken:string;expectedFamilyCount:string;expectedRevisionCount:string;expectedItemCount:string;families:readonly StoredQuoteFamily[];revisions:readonly StoredQuoteRevision[];items:readonly StoredQuoteItem[]}>;
type Entity='quote_families'|'quote_revisions'|'quote_items';
type Escape=Readonly<{entity:Entity;row_id:string;column:string;apostrophe_prefix:true}>;
export class QuoteDraftCsvError extends Error{constructor(){super('QUOTE_DRAFT_CSV_REVIEW_REQUIRED');this.name='QuoteDraftCsvError';}}
const profile='crest.quote-draft.sources.v1',partLimit=8*1024*1024,totalLimit=32*1024*1024;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"',hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
const jsonColumns:Record<Entity,readonly string[]>={quote_families:[],quote_revisions:['customer_safe_snapshot','internal_snapshot'],quote_items:['line_discount','customer_snapshot']};
function same(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((value,index)=>same(value,b[index]));
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const left=a as Record<string,unknown>,right=b as Record<string,unknown>,keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&same(left[key],right[key]));
}
function cell(value:unknown,json:boolean):string|null{
 if(json){const encoded=JSON.stringify(value);check(typeof encoded==='string');return encoded;}
 if(value===null)return null;
 check(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isSafeInteger(value));return String(value);
}
// The unescaped cell lengths are a lower bound on final CSV bytes. Reject an
// impossible part while validating rows, before retaining an oversized table.
function budget<T>(entity:Entity,columns:readonly (keyof T&string)[]){let bytes=0;return(row:T)=>{for(const column of columns){const value=cell(row[column],jsonColumns[entity].includes(column));if(value!==null)bytes+=Buffer.byteLength(value);}check(bytes<=partLimit);return row;};}
function table<T extends {id:string}>(entity:Entity,rows:readonly T[],columns:readonly (keyof T&string)[],escapes:Escape[]){
 const lines=[columns.map(quote).join(',')];let bytes=Buffer.byteLength(lines[0]!)+2;
 for(const row of rows){const cells=columns.map(column=>{
  const json=jsonColumns[entity].includes(column),value=cell(row[column],json);if(value===null)return quote('\\N');
  let text=value.replaceAll('\\','\\\\');
  if(!json&&typeof row[column]==='string'&&(text.startsWith("'")||['=','+','-','@'].includes(text.trimStart()[0]??''))){text="'"+text;escapes.push({entity,row_id:row.id,column,apostrophe_prefix:true});}
  return quote(text);
 }),line=cells.join(',');bytes+=Buffer.byteLength(line)+2;check(bytes<=partLimit);lines.push(line);}
 return lines.join('\r\n')+'\r\n';
}
const idOrder=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
export function formatQuoteDraftCsv(input:QuoteDraftSourceInput){
 try{
  check(exact(input,['businessId','snapshotToken','expectedFamilyCount','expectedRevisionCount','expectedItemCount','families','revisions','items'])&&quoteId(input.businessId)
   &&typeof input.snapshotToken==='string'&&input.snapshotToken.length===64&&/^[a-f0-9]+$/.test(input.snapshotToken)
   &&quoteVersion(input.expectedFamilyCount,true)&&quoteVersion(input.expectedRevisionCount,true)&&quoteVersion(input.expectedItemCount,true)
   &&Array.isArray(input.families)&&Array.isArray(input.revisions)&&Array.isArray(input.items)
   &&BigInt(input.expectedFamilyCount)===BigInt(input.families.length)&&BigInt(input.expectedRevisionCount)===BigInt(input.revisions.length)&&BigInt(input.expectedItemCount)===BigInt(input.items.length));
  const businessId=input.businessId,snapshotToken=input.snapshotToken,fitFamilies=budget<StoredQuoteFamily>('quote_families',quoteFamilyColumns),fitRevisions=budget<StoredQuoteRevision>('quote_revisions',quoteRevisionColumns),fitItems=budget<StoredQuoteItem>('quote_items',quoteItemColumns);
  const families=Array.from(input.families,row=>fitFamilies(parseStoredQuoteFamily(row,businessId))).sort(idOrder),parents=new Map(families.map(row=>[row.id,row]));check(parents.size===families.length);
  const byFamily=new Map<string,StoredQuoteRevision[]>(),revisions=Array.from(input.revisions,row=>{
   check(exact(row,quoteRevisionColumns)&&quoteId(row.family_id)&&parents.has(row.family_id));const parsed=fitRevisions(parseStoredQuoteRevision(row,businessId,row.family_id));
   check(hash(parsed.canonical_content)===parsed.content_hash);const parent=parents.get(parsed.family_id)!;check(parsed.internal_snapshot.customerId===parent.customer_id&&parsed.internal_snapshot.leadId===parent.lead_id);
   const grouped=byFamily.get(parent.id)??[];grouped.push(parsed);byFamily.set(parent.id,grouped);return parsed;
  }).sort(idOrder),byRevision=new Map(revisions.map(row=>[row.id,row]));check(byRevision.size===revisions.length);
  for(const family of families){const members=(byFamily.get(family.id)??[]).sort((a,b)=>BigInt(a.sequence)<BigInt(b.sequence)?-1:BigInt(a.sequence)>BigInt(b.sequence)?1:0);check(members.length>0&&members.every((row,index)=>row.sequence===String(index+1))&&byRevision.get(family.current_revision_id)?.family_id===family.id);}
  const byItemRevision=new Map<string,StoredQuoteItem[]>(),items=Array.from(input.items,row=>{
   check(exact(row,quoteItemColumns)&&quoteId(row.revision_id)&&byRevision.has(row.revision_id));const parsed=fitItems(parseStoredQuoteItem(row,businessId,row.revision_id)),grouped=byItemRevision.get(parsed.revision_id)??[];grouped.push(parsed);byItemRevision.set(parsed.revision_id,grouped);return parsed;
  }).sort(idOrder);check(new Set(items.map(row=>row.id)).size===items.length);
  for(const revision of revisions){
   const all=byItemRevision.get(revision.id)??[],active=all.filter(row=>row.active).sort((a,b)=>a.position!-b.position!);check(new Set(all.map(row=>row.stable_line_key)).size===all.length&&active.length===revision.customer_safe_snapshot.lines.length);
   active.forEach((row,index)=>check(row.position===index+1&&same(row.customer_snapshot,revision.customer_safe_snapshot.lines[index])&&same({stableLineKey:row.stable_line_key,vehicleId:row.vehicle_id,jobWide:row.job_wide,serviceVersionId:row.service_version_id},revision.internal_snapshot.sources[index])));
   const calculated=calculateQuote(active.map(row=>({id:row.stable_line_key,grossCents:row.gross_cents,lineDiscount:row.line_discount,documentDiscountEligible:row.document_discount_eligible,complimentaryReason:row.complimentary_reason})),revision.customer_safe_snapshot.documentDiscount);
   check(calculated.totalCents===revision.total_cents&&(['grossCents','lineDiscountCents','documentDiscountCents','totalCents'] as const).every(key=>calculated[key]===revision.customer_safe_snapshot[key]));
   active.forEach((row,index)=>{const price=calculated.lines[index]!;check(row.line_discount_cents===price.lineDiscountCents&&row.allocated_discount_cents===price.allocatedDiscountCents&&row.final_cents===price.finalCents);});
  }
  const escapes:Escape[]=[],familiesCsv=table('quote_families',families,quoteFamilyColumns,escapes),revisionsCsv=table('quote_revisions',revisions,quoteRevisionColumns,escapes),itemsCsv=table('quote_items',items,quoteItemColumns,escapes);
  const escapeMap=JSON.stringify({schemaVersion:1,profile,businessId,snapshotToken,escapes})+'\n';
  const dictionary=JSON.stringify({schemaVersion:1,profile,tables:{quote_families:{columns:quoteFamilyColumns,jsonColumns:jsonColumns.quote_families,scalarTypes:{version:'exact decimal string'}},quote_revisions:{columns:quoteRevisionColumns,jsonColumns:jsonColumns.quote_revisions,scalarTypes:{sequence:'exact decimal string',version:'exact decimal string',content_version:'exact decimal string',total_cents:'exact decimal string cents',customer_safe_snapshot:'JSON text',internal_snapshot:'JSON text',canonical_content:'exact UTF-8 text; do not reserialize'}},quote_items:{columns:quoteItemColumns,jsonColumns:jsonColumns.quote_items,scalarTypes:{active:'boolean',job_wide:'boolean',document_discount_eligible:'boolean',position:'nullable bounded integer',version:'exact decimal string',gross_cents:'exact decimal string cents',line_discount_cents:'exact decimal string cents',allocated_discount_cents:'exact decimal string cents',final_cents:'exact decimal string cents',line_discount:'JSON text; null is a JSON value',customer_snapshot:'JSON text'}}},null:'\\N',csv:'UTF-8 RFC4180 CRLF',instants:'UTC with six fractional digits',decode:'Parse CSV as text. Unescaped \\N is SQL null in nullable scalar columns. Remove exactly the apostrophe named by entity/row/column in the escape map, then unescape paired backslashes. Parse declared JSON columns as JSON, including the text null for a JSON null; never infer JSON from other text. Parse only declared boolean cells as boolean and position as a bounded integer. Keep money, versions, sequences, UUIDs and all other scalar columns as text; spreadsheet quoting does not impose a cell type.',privacy:'Owner-only private quote sources, including internal snapshots, source IDs and notes. Never customer-safe sharing.',completeness:'Included quote family/revision/item consistency only. This formatter does not establish collection authorization, one-snapshot origin, undisclosed rows, external customer/lead/vehicle/catalog/actor/operation/audit closure or recoverable backup custody.',bounds:{partBytes:partLimit,totalBytes:totalLimit,behavior:'Reject the entire formatting result on overflow; no row or field is silently dropped.'}})+'\n';
  const parts=[['quote_families.csv',familiesCsv],['quote_revisions.csv',revisionsCsv],['quote_items.csv',itemsCsv],['quote_draft_escape_map.json',escapeMap],['quote_draft_dictionary.json',dictionary]].map(([name,content])=>({name:name!,bytes:Buffer.byteLength(content!),sha256:hash(content!)}));check(parts.every(part=>part.bytes<=partLimit));
  const manifest=JSON.stringify({schemaVersion:1,profile,businessId,snapshotToken,familyCount:String(families.length),revisionCount:String(revisions.length),itemCount:String(items.length),assurance:'included_quote_consistency_only',snapshotProven:false,sourceCompletenessProven:false,referenceClosureComplete:false,completeCrestExport:false,completeBackup:false,parts})+'\n';check(Buffer.byteLength(manifest)<=partLimit&&parts.reduce((sum,part)=>sum+part.bytes,0)+Buffer.byteLength(manifest)<=totalLimit);
  return Object.freeze({familiesCsv,revisionsCsv,itemsCsv,escapeMap,dictionary,manifest});
 }catch{throw new QuoteDraftCsvError();}
}
