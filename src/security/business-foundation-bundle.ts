import 'server-only';
import {createHash} from 'node:crypto';
import {verifyBusinessFoundationEvidence} from './business-configuration-evidence.ts';
import {formatBusinessHistoryCsv} from './business-history-csv.ts';

type Input=Readonly<{configuration:string;identity:string;history:string}>;
type Part=Readonly<{name:string;contentType:'text/csv; charset=utf-8'|'application/json'|'text/plain; charset=utf-8';content:string;bytes:number;sha256:string}>;
type Bundle=Readonly<{parts:readonly Part[];manifest:string}>;
export type BusinessFoundationBundle=Readonly<{forServer:()=>Bundle;toJSON:()=>never}>;
export class BusinessFoundationBundleError extends Error{
 constructor(){super('BUSINESS_FOUNDATION_BUNDLE_REVIEW_REQUIRED');this.name='BusinessFoundationBundleError';}
}
const entities={business:'businesses',membership:'memberships',recovery_authority:'business_recovery_authorities',actor:'actors',role_capability:'role_capabilities',identity_event:'identity_events'} as const;
const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"';
const maxPart=8*1024*1024,maxBundle=64*1024*1024;
function require(value:unknown):asserts value{if(!value)throw new BusinessFoundationBundleError();}

// Pure bounded formatting of the three already captured source collections.
// The unchanged joined verifier establishes internal consistency, never owner
// authority, source authenticity, a Ready job or complete Crest portability.
export function formatBusinessFoundationBundle(input:Input,expected:Readonly<{businessId:string}>):BusinessFoundationBundle{
 try{
  const source={configuration:input.configuration,identity:input.identity,history:input.history},binding={businessId:expected.businessId};
  const verified=verifyBusinessFoundationEvidence(source.configuration,source.identity,source.history,binding);
  const {generationId}=verified,{businessId,observedAt}=verified.configuration.context;
  require([verified.identity,verified.history].every(group=>group.context.observedAt===observedAt));
  const parts:Part[]=[];let total=0;
  function add(name:string,content:string){
   const bytes=Buffer.byteLength(content);require(bytes<=maxPart&&total+bytes<=maxBundle&&parts.length<1024&&!parts.some(p=>p.name===name));total+=bytes;
   const contentType=name.endsWith('.csv')?'text/csv; charset=utf-8':name.endsWith('.json')?'application/json':'text/plain; charset=utf-8';
   parts.push(Object.freeze({name,contentType,content,bytes,sha256:createHash('sha256').update(content).digest('hex')}));
  }
  for(const group of [verified.configuration,verified.identity])for(const [kind,entity] of Object.entries(entities)){
   const records=group.records.filter(record=>record.kind===kind);if(!records.length)continue;
   // Every row has already passed the closed complete source schema. Sorted
   // names make output independent of JSON object insertion order. These six
   // required foundation groups cannot be empty after joined verification.
   const columns=Object.keys(JSON.parse(records[0]!.canonicalEvidence).row).sort();
   const escapes:{row_id:string;column:string;apostrophe_prefix:true}[]=[];
   const lines=[columns.map(quote).join(',')];let csvBytes=Buffer.byteLength(lines[0]!)+2;
   for(const record of records){
    const row=JSON.parse(record.canonicalEvidence).row as Record<string,unknown>;
    require(Object.keys(row).sort().join(',')===columns.join(','));
    const line=columns.map(column=>{
     const original=row[column];if(original===null)return quote('\\N');
     require(typeof original==='string'||typeof original==='boolean');
     let value=String(original).replaceAll('\\','\\\\');
     if(typeof original==='string'&&(value.startsWith("'")||['=','+','-','@'].includes(value.trimStart()[0]??''))){value="'"+value;escapes.push({row_id:record.recordId,column,apostrophe_prefix:true});}
     return quote(value);
    }).join(',');
    csvBytes+=Buffer.byteLength(line)+2;require(csvBytes<=maxPart);lines.push(line);
   }
   add(entity+'.csv',lines.join('\r\n')+'\r\n');
   add(entity+'_escape_map.json',JSON.stringify({schemaVersion:1,entity,businessId,generationId,snapshotToken:group.context.snapshotToken,escapes})+'\n');
   add(entity+'_dictionary.json',JSON.stringify({schemaVersion:1,entity,columns,null:'\\N',csv:'UTF-8 RFC4180 CRLF',booleanColumns:kind==='membership'?['active']:kind==='recovery_authority'?['writes_enabled']:[],jsonTextColumns:kind==='identity_event'?['payload']:[],exactTextColumns:columns.filter(c=>c==='version'||c==='entity_version'),decode:'Parse CSV as text. Unescaped \\N is null. Remove exactly the apostrophe recorded for that row ID and column, then unescape paired backslashes. Convert only declared boolean columns (true/false). Keep versions, UUIDs, instants and original JSON payloads as text. Parse JSON payloads only with exact numeric handling.',completeness:'All projected columns in this verified foundation group; internal consistency only. Not a complete Crest export or backup.'})+'\n');
  }
  const history=formatBusinessHistoryCsv(source.history,binding);
  for(const [entity,formatted] of [['operations',history.operations],['audit_events',history.audits]] as const){
   add(entity+'.csv',formatted.csv);add(entity+'_escape_map.json',formatted.escapeMap);add(entity+'_dictionary.json',formatted.dictionary);
  }
  // Preserve original evidence strings without JSON/Number conversion. Bounded
  // source pages reconstruct the unchanged verifier input; none is a complete
  // collection alone. Greedy byte paging avoids one object per source record.
  const sourcePages:Record<string,string[]>={};
  for(const name of ['configuration','identity','history'] as const){
   const group=verified[name],names:string[]=[];let records:string[]=[],recordBytes=0,page=1;
   const prefix=()=>JSON.stringify({formatVersion:1,profile:'crest.foundation-source-page.v1',group:name,generationId,context:group.context,page}).slice(0,-1)+',"records":[';
   function flush(){const file='foundation_'+name+'_source_'+String(page).padStart(4,'0')+'.json';add(file,prefix()+records.join(',')+']}\n');names.push(file);page++;records=[];recordBytes=0;}
   for(const record of group.records){
    const text=JSON.stringify(record),bytes=Buffer.byteLength(text);
    if(Buffer.byteLength(prefix())+recordBytes+records.length+bytes+3>maxPart){require(records.length>0);flush();}
    require(Buffer.byteLength(prefix())+recordBytes+records.length+bytes+3<=maxPart);records.push(text);recordBytes+=bytes;
   }
   if(records.length||!names.length)flush();sourcePages[name]=names;
  }
  add('foundation_readme.txt','Crest foundation export profile 1\nPrivate business, identity and operation/audit evidence. This is a partial Crest export, not a backup.\nUse each CSV with its dictionary and escape map; import columns as text before decoding.\nReconstruct each source collection from the manifest-ordered source pages: require matching profile/group/generation/context, consecutive page numbers and exact part bytes/SHA256. Concatenate records in order. Use {formatVersion:1,assurance:"snapshot_bytes_only",generationId,context,evidenceBytes,records}, with evidenceBytes from sourceCollections. canonicalEvidence strings must remain unchanged. Run the existing lossless foundation verifier on all three reconstructed collections together.\nUnkeyed hashes prove byte consistency only. Capture provenance, authorization, full reference closure, encrypted custody and download authorization are separate gates.\n');
  const manifest=JSON.stringify({formatVersion:1,profile:'crest.foundation-bundle.v1',generationId,businessId,observedAt,assurance:'internal_consistency_only',configurationCurrentRowsVerified:true,includedActorReferencesVerified:true,consistentCaptureProven:false,referenceClosureComplete:false,completePortableExport:false,completeBackup:false,sourceCollections:Object.fromEntries((['configuration','identity','history'] as const).map(name=>[name,{context:verified[name].context,evidenceBytes:verified[name].evidenceBytes,recordCount:verified[name].records.length,pages:sourcePages[name]}])),parts:parts.map(({name,contentType,bytes,sha256})=>({name,contentType,bytes,sha256}))})+'\n';
  // The manifest is handed separately to its future durable job owner; its
  // checksum cannot self-reference. It is subject to the same processing cap.
  require(Buffer.byteLength(manifest)<=maxPart&&total+Buffer.byteLength(manifest)<=maxBundle);
  const value=Object.freeze({parts:Object.freeze(parts),manifest});
  return Object.freeze({forServer:()=>value,toJSON:()=>{throw new BusinessFoundationBundleError();}});
 }catch{throw new BusinessFoundationBundleError();}
}
