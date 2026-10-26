import 'server-only';
import {createHash} from 'node:crypto';
import {readSourceExportCsv} from './source-export-csv-reader.ts';
import {parseHistoryJson,historyJsonEqual} from './history-evidence-json.ts';
import {verifyBusinessFoundationEvidence} from './business-configuration-evidence.ts';
import {customerColumns,parseCustomer} from '../customer/customer-contract.ts';
import {addressColumns,parseCustomerAddress} from '../customer/customer-address-contract.ts';
import {vehicleColumns,parseVehicle} from '../customer/vehicle-contract.ts';
import {associationColumns,parseAssociation} from '../customer/vehicle-association-contract.ts';
import {leadColumns,leadSourceColumns,parseLead,parseLeadSource} from '../customer/lead-contract.ts';
import {leadEventColumns,parseLeadEvent} from '../customer/lead-state-contract.ts';
import {leadVehicleColumns,parseLeadVehicle} from '../customer/lead-vehicle-contract.ts';
import {leadAddressColumns,parseLeadAddress} from '../customer/lead-address-contract.ts';
import {leadConversionColumns,conversionLinkColumns,parseLeadConversionRecord,parseConversionLink,parseLeadConversionCollection} from '../customer/lead-conversion-record.ts';

type Body=Record<string,unknown>;
type Part=Readonly<{name:string;bytes:Uint8Array}>;
type Rule=Readonly<{scope:string;field:string;prefix:string;entity:string;escape:string;columns:readonly string[];parse:(row:unknown,businessId:string)=>object;booleans?:readonly string[];integers?:readonly string[];json?:readonly string[]}>;
const crmRules={
 customers:{scope:'customer_directory',field:'customers',prefix:'customers',entity:'customers',escape:'customer',columns:customerColumns,parse:parseCustomer,booleans:['outreach_opt_out']},
 addresses:{scope:'address_directory',field:'addresses',prefix:'addresses',entity:'addresses',escape:'address',columns:addressColumns,parse:parseCustomerAddress},
 vehicles:{scope:'vehicle_directory',field:'vehicles',prefix:'vehicles',entity:'vehicles',escape:'vehicle',columns:vehicleColumns,parse:parseVehicle,integers:['year']},
 associations:{scope:'vehicle_associations',field:'associations',prefix:'associations',entity:'customer_vehicles',escape:'association',columns:associationColumns,parse:parseAssociation,booleans:['is_billing']},
 leadSources:{scope:'lead_source_directory',field:'lead_sources',prefix:'lead_sources',entity:'lead_sources',escape:'lead_sources',columns:leadSourceColumns,parse:parseLeadSource,booleans:['active']},
 leads:{scope:'lead_directory',field:'leads',prefix:'leads',entity:'leads',escape:'leads',columns:leadColumns,parse:parseLead,json:['source_snapshot']},
 leadEvents:{scope:'lead_state_events',field:'events',prefix:'lead_events',entity:'lead_events',escape:'lead_events',columns:leadEventColumns,parse:parseLeadEvent},
 leadVehicles:{scope:'lead_vehicle_intake',field:'leadVehicles',prefix:'lead_vehicles',entity:'lead_vehicles',escape:'lead_vehicles',columns:leadVehicleColumns,parse:parseLeadVehicle,json:['reported_vehicle','requested_services']},
 leadAddresses:{scope:'lead_address_intake',field:'leadAddresses',prefix:'lead_addresses',entity:'lead_addresses',escape:'lead_addresses',columns:leadAddressColumns,parse:parseLeadAddress},
 conversions:{scope:'lead_conversion',field:'conversions',prefix:'conversions',entity:'lead_conversions',escape:'lead_conversions',columns:leadConversionColumns,parse:parseLeadConversionRecord,json:['request']},
 links:{scope:'lead_conversion',field:'links',prefix:'links',entity:'conversion_links',escape:'conversion_links',columns:conversionLinkColumns,parse:parseConversionLink}
} satisfies Record<string,Rule>;
type Name=keyof typeof crmRules;
const names=Object.keys(crmRules) as Name[],groups=['configuration','identity','history'] as const;
const foundationEntities={business:'businesses',membership:'memberships',recovery_authority:'business_recovery_authorities',actor:'actors',role_capability:'role_capabilities',identity_event:'identity_events',operation:'operations',audit_event:'audit_events'} as const;
const operationColumns=['id','business_id','operation_id','actor_id','command_type','schema_version','recovery_epoch','payload_hash','state','result_schema_version','result','committed_at','created_at','created_by','origin','import_row_id'];
const auditColumns=['id','business_id','operation_id','actor_id','entity_kind','entity_id','entity_version','action','reason','effective_at','delta','created_at','recorded_at','created_by','origin','import_row_id','database_principal','payload','hash_input','event_hash'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,hash=/^[a-f0-9]{64}$/,fileName=/^[a-z][a-z0-9_]{0,79}\.(csv|json|txt)$/;
const maxPart=8*1024*1024,maxTotal=64*1024*1024;
export class BusinessSourceVerificationError extends Error{constructor(){super('SOURCE_EXPORT_REVIEW_REQUIRED');this.name='BusinessSourceVerificationError';}}
function require(value:unknown):asserts value{if(!value)throw new BusinessSourceVerificationError();}
function body(value:unknown):asserts value is Body{require(value!==null&&typeof value==='object'&&!Array.isArray(value));}
function exact(value:unknown,keys:readonly string[]):asserts value is Body{body(value);require(Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)));}
function integer(value:unknown,max:number):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;}
function count(value:unknown):value is string{return typeof value==='string'&&/^(0|[1-9][0-9]{0,3})$/.test(value)&&Number(value)<=1000;}
function json(text:string):Body{const value:unknown=JSON.parse(text);require(historyJsonEqual(parseHistoryJson(text),parseHistoryJson(JSON.stringify(value))));body(value);return value;}
function text(bytes:Uint8Array){const copy=Buffer.from(bytes),value=copy.toString('utf8');require(!value.includes('\0')&&copy.equals(Buffer.from(value)));return value;}
function same(left:unknown,right:unknown){require(historyJsonEqual(left,right));}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}

// Independent offline verification. Never imports a CSV writer/formatter or
// uses provider/database/network access. Unkeyed hashes are not authenticity.
export function verifyBusinessSourceBundle(input:Readonly<{manifest:Uint8Array;parts:readonly Part[]}>,expected:Readonly<{businessId:string;appReleaseId?:string}>){
 try{
  const businessId=expected.businessId,release=expected.appReleaseId;require(typeof businessId==='string'&&uuid.test(businessId)&&(release===undefined||typeof release==='string'&&/^[a-f0-9]{40}$/.test(release)));
  const manifestInput=input.manifest;require(manifestInput instanceof Uint8Array&&manifestInput.byteLength<=maxPart&&Array.isArray(input.parts)&&input.parts.length<=1024);const manifestBytes=Buffer.from(manifestInput);
  let total=manifestBytes.byteLength;const files=new Map<string,{text:string;bytes:number;sha256:string}>();
  for(const part of input.parts){
   exact(part,['name','bytes']);require(typeof part.name==='string'&&fileName.test(part.name)&&part.name!=='source_manifest.json'&&!files.has(part.name)&&part.bytes instanceof Uint8Array&&part.bytes.byteLength>0&&part.bytes.byteLength<=maxPart);
   const bytes=Buffer.from(part.bytes);total+=bytes.byteLength;require(total<=maxTotal);files.set(part.name,{text:text(bytes),bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const manifest=json(text(manifestBytes));exact(manifest,['formatVersion','profile','generationId','businessId','observedAt','appReleaseId','sourceSchemaVersion','captureDeclared','assurance','consistentCaptureProven','includedCrmReferencesVerified','referenceClosureComplete','completePortableExport','completeBackup','foundationManifest','evidenceBytes','recordCount','crmEvidenceBytes','crmRecordCount','sourceCollections','parts']);
  require(manifest.formatVersion===1&&manifest.profile==='crest.business-source-bundle.v1'&&manifest.businessId===businessId&&typeof manifest.generationId==='string'&&uuid.test(manifest.generationId)&&typeof manifest.appReleaseId==='string'&&/^[a-f0-9]{40}$/.test(manifest.appReleaseId)&&(release===undefined||release===manifest.appReleaseId)&&manifest.sourceSchemaVersion===42&&manifest.captureDeclared==='single_connection_repeatable_read'&&manifest.assurance==='internal_consistency_only'&&manifest.consistentCaptureProven===false&&manifest.includedCrmReferencesVerified===true&&manifest.referenceClosureComplete===false&&manifest.completePortableExport===false&&manifest.completeBackup===false&&manifest.foundationManifest==='foundation_manifest.json'&&integer(manifest.evidenceBytes,maxPart)&&integer(manifest.recordCount,10000)&&integer(manifest.crmEvidenceBytes,maxPart)&&integer(manifest.crmRecordCount,10000));
  const descriptors=new Map<string,Body>(),used=new Set<string>();require(Array.isArray(manifest.parts)&&manifest.parts.length===files.size);
  for(const descriptor of manifest.parts){
   exact(descriptor,['name','contentType','bytes','sha256']);require(typeof descriptor.name==='string'&&!descriptors.has(descriptor.name));const file=files.get(descriptor.name);require(file&&descriptor.bytes===file.bytes&&descriptor.sha256===file.sha256);
   require(descriptor.contentType===(descriptor.name.endsWith('.csv')?'text/csv; charset=utf-8':descriptor.name.endsWith('.json')?'application/json':'text/plain; charset=utf-8'));descriptors.set(descriptor.name,descriptor);
  }
  function read(name:unknown){require(typeof name==='string'&&descriptors.has(name)&&files.has(name));used.add(name);return files.get(name)!.text;}
  function listed(value:unknown,withType:boolean){
   require(Array.isArray(value));const listed=new Set<string>();
   for(const item of value){exact(item,withType?['name','contentType','bytes','sha256']:['name','bytes','sha256']);require(typeof item.name==='string'&&!listed.has(item.name));const descriptor=descriptors.get(item.name);require(descriptor&&item.bytes===descriptor.bytes&&item.sha256===descriptor.sha256&&(!withType||item.contentType===descriptor.contentType));listed.add(item.name);}
   return listed;
  }
  const foundation=json(read(manifest.foundationManifest));exact(foundation,['formatVersion','profile','generationId','businessId','observedAt','assurance','configurationCurrentRowsVerified','includedActorReferencesVerified','consistentCaptureProven','referenceClosureComplete','completePortableExport','completeBackup','sourceCollections','parts']);
  require(foundation.formatVersion===1&&foundation.profile==='crest.foundation-bundle.v1'&&foundation.generationId===manifest.generationId&&foundation.businessId===businessId&&foundation.observedAt===manifest.observedAt&&foundation.assurance==='internal_consistency_only'&&foundation.configurationCurrentRowsVerified===true&&foundation.includedActorReferencesVerified===true&&foundation.consistentCaptureProven===false&&foundation.referenceClosureComplete===false&&foundation.completePortableExport===false&&foundation.completeBackup===false);
  const foundationParts=listed(foundation.parts,true),foundationUsed=new Set<string>();exact(foundation.sourceCollections,groups);
  function foundationRead(name:unknown){require(typeof name==='string'&&foundationParts.has(name));foundationUsed.add(name);return read(name);}
  const serialized={} as Record<typeof groups[number],string>;
  for(const group of groups){
   const collection=foundation.sourceCollections[group];exact(collection,['context','evidenceBytes','recordCount','pages']);require(integer(collection.evidenceBytes,maxPart)&&integer(collection.recordCount,10000)&&Array.isArray(collection.pages)&&collection.pages.length>=1&&collection.pages.length<=1024);
   const records:unknown[]=[];
   for(const [index,name]of collection.pages.entries()){
    require(name==='foundation_'+group+'_source_'+String(index+1).padStart(4,'0')+'.json');const page=json(foundationRead(name));exact(page,['formatVersion','profile','group','generationId','context','page','records']);
    require(page.formatVersion===1&&page.profile==='crest.foundation-source-page.v1'&&page.group===group&&page.generationId===manifest.generationId&&page.page===index+1&&Array.isArray(page.records));same(page.context,collection.context);
    require(collection.recordCount===0?collection.pages.length===1&&page.records.length===0:page.records.length>0);records.push(...page.records);require(records.length<=collection.recordCount);
   }
   require(records.length===collection.recordCount);serialized[group]=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:manifest.generationId,context:collection.context,evidenceBytes:collection.evidenceBytes,records});
  }
  const verified=verifyBusinessFoundationEvidence(serialized.configuration,serialized.identity,serialized.history,{businessId});
  require(verified.generationId===manifest.generationId&&groups.every(group=>verified[group].context.observedAt===manifest.observedAt));
  const rows:Record<string,readonly Readonly<Body>[]>={};
  function csv(entity:string,prefix:string,columns:readonly string[],source:readonly Readonly<Body>[],snapshotToken:string,readFile:(name:string)=>string,types:Readonly<{booleans?:readonly string[];integers?:readonly string[];json?:readonly string[]}>,kind:'foundation'|'history'|'crm'){
   const escape=json(readFile(prefix+'_escape_map.json'));exact(escape,kind==='foundation'?['schemaVersion','entity','businessId','generationId','snapshotToken','escapes']:['schemaVersion','entity','businessId','snapshotToken','escapes']);
   require(escape.schemaVersion===1&&escape.entity===entity&&escape.businessId===businessId&&escape.snapshotToken===snapshotToken&&(kind!=='foundation'||escape.generationId===manifest.generationId));
   const dictionary=json(readFile(prefix+'_dictionary.json'));
   exact(dictionary,kind==='foundation'?['schemaVersion','entity','columns','null','csv','booleanColumns','jsonTextColumns','exactTextColumns','decode','completeness']:kind==='history'?['schemaVersion','entity','columns','null','csv','jsonTextColumns','exactTextColumns','instants','decode','completeness']:['schemaVersion','entity','columns','null','csv','scalarTypes','decode','completeness']);
   require(dictionary.schemaVersion===1&&dictionary.entity===entity&&dictionary.null==='\\N'&&dictionary.csv==='UTF-8 RFC4180 CRLF'&&typeof dictionary.decode==='string'&&typeof dictionary.completeness==='string');same(dictionary.columns,columns);
   if(kind==='foundation'){same(dictionary.booleanColumns,types.booleans??[]);same(dictionary.jsonTextColumns,entity==='identity_events'?['payload']:[]);same(dictionary.exactTextColumns,columns.filter(c=>c==='version'||c==='entity_version'));}
   if(kind==='history'){same(dictionary.jsonTextColumns,entity==='operations'?['result']:['delta','payload']);same(dictionary.exactTextColumns,entity==='operations'?[]:['entity_version']);require(typeof dictionary.instants==='string');}
   if(kind==='crm'){body(dictionary.scalarTypes);require(Object.values(dictionary.scalarTypes).every(value=>typeof value==='string'));}
   const decoded=readSourceExportCsv(readFile(entity+'.csv'),escape.escapes,{columns,maxRows:source.length,...types});same(decoded,source);rows[entity]=decoded;
  }
  for(const [kind,entity]of Object.entries(foundationEntities)){
   const group=kind==='operation'||kind==='audit_event'?'history':kind==='business'||kind==='membership'||kind==='recovery_authority'?'configuration':'identity';
   const source=verified[group].records.filter(record=>record.kind===kind).map(record=>json(record.canonicalEvidence).row as Body);
   const columns=kind==='operation'?operationColumns:kind==='audit_event'?auditColumns:Object.keys(source[0]!).sort();
   csv(entity,entity,columns,source,verified[group].context.snapshotToken,foundationRead,{booleans:kind==='membership'?['active']:kind==='recovery_authority'?['writes_enabled']:[],integers:kind==='operation'?['schema_version','result_schema_version']:[]},group==='history'?'history':'foundation');
  }
  foundationRead('foundation_readme.txt');require(foundationUsed.size===foundationParts.size);
  exact(manifest.sourceCollections,names);const contexts:Record<string,string>={},pages:Record<string,string[]>={},sourceRows={} as Record<Name,Body[]>,tokens=new Set<string>();let crmBytes=0,crmCount=0;
  for(const name of names){
   const rule:Rule=crmRules[name],collection=manifest.sourceCollections[name];exact(collection,['context','pages']);
   const contextFile='crm_'+(name==='links'?'conversions':rule.prefix)+'_context.json';require(collection.context===contextFile&&Array.isArray(collection.pages)&&collection.pages.length>=1&&collection.pages.length<=51);
   const contextText=read(contextFile);require(Buffer.byteLength(contextText)<=1048576);const context=json(contextText),counts=name==='links'||name==='conversions'?['conversionCount','linkCount']:['rowCount'];
   exact(context,['schemaVersion','scope','businessId','snapshotToken',...counts]);require(context.schemaVersion===1&&context.scope===rule.scope&&context.businessId===businessId&&typeof context.snapshotToken==='string'&&hash.test(context.snapshotToken)&&counts.every(key=>count(context[key])));
   if(name!=='links'){contexts[name]=contextText;crmBytes+=Buffer.byteLength(contextText);tokens.add(context.snapshotToken);}sourceRows[name]=[];pages[name]=[];let previous='';
   for(const [index,file]of collection.pages.entries()){
    require(file==='crm_'+rule.prefix+'_page_'+String(index+1).padStart(4,'0')+'.json');const raw=read(file);require(Buffer.byteLength(raw)<=1048576);const page=json(raw);
    exact(page,['schemaVersion','businessId','snapshotToken',rule.field]);require(page.schemaVersion===1&&page.businessId===businessId&&page.snapshotToken===context.snapshotToken);const items=page[rule.field];require(Array.isArray(items));
    require(index===collection.pages.length-1?items.length<20:items.length===20);
    for(const item of items){const row={...rule.parse(item,businessId)} as Body;require(typeof row.id==='string'&&row.id>previous);previous=row.id;sourceRows[name].push(row);require(sourceRows[name].length<=1000);}
    pages[name]!.push(raw);crmBytes+=Buffer.byteLength(raw);require(crmBytes<=maxPart);
   }
   require(String(sourceRows[name].length)===(name==='links'?context.linkCount:name==='conversions'?context.conversionCount:context.rowCount));crmCount+=sourceRows[name].length;
   csv(rule.entity,rule.escape,rule.columns,sourceRows[name],context.snapshotToken,read,rule,'crm');
   if(name!=='links'){
    const child=json(read('crm_'+rule.prefix+'_manifest.json'));exact(child,name==='conversions'?['schemaVersion','scope','businessId','snapshotToken','conversionCount','linkCount','completeCrestExport','completeBackup','parts']:['schemaVersion','scope','businessId','snapshotToken','rowCount','completeCrestExport','completeBackup','parts']);
    require(child.schemaVersion===1&&child.scope===rule.scope&&child.businessId===businessId&&child.snapshotToken===context.snapshotToken&&child.completeCrestExport===false&&child.completeBackup===false);for(const key of counts)same(child[key],context[key]);
    const actual=listed(child.parts,false),expectedFiles=name==='conversions'?['lead_conversions.csv','lead_conversions_escape_map.json','lead_conversions_dictionary.json','conversion_links.csv','conversion_links_escape_map.json','conversion_links_dictionary.json']:[rule.entity+'.csv',rule.escape+'_escape_map.json',rule.escape+'_dictionary.json'];same([...actual].sort(),expectedFiles.sort());
   }
  }
  require(tokens.size===10&&crmBytes===manifest.crmEvidenceBytes&&crmCount===manifest.crmRecordCount);
  const evidenceBytes=crmBytes+groups.reduce((n,group)=>n+verified[group].evidenceBytes,0),recordCount=crmCount+groups.reduce((n,group)=>n+verified[group].records.length,0);require(evidenceBytes===manifest.evidenceBytes&&evidenceBytes<=maxPart&&recordCount===manifest.recordCount&&recordCount<=10000);
  const relations:Record<string,Record<string,string>>={addresses:{customer_id:'customers'},customer_vehicles:{customer_id:'customers',vehicle_id:'vehicles'},lead_sources:{referral_customer_id:'customers'},leads:{customer_id:'customers',source_id:'lead_sources'},lead_events:{lead_id:'leads'},lead_vehicles:{lead_id:'leads',vehicle_id:'vehicles'},lead_addresses:{lead_id:'leads'},lead_conversions:{lead_id:'leads',customer_id:'customers'},conversion_links:{conversion_id:'lead_conversions',lead_id:'leads',lead_vehicle_id:'lead_vehicles',vehicle_id:'vehicles',lead_address_id:'lead_addresses',address_id:'addresses'}};
  const ids=new Map(Object.entries(rows).map(([entity,items])=>[entity,new Set(items.map(row=>row.id))]));
  for(const [entity,fields]of Object.entries(relations))for(const row of rows[entity]!)for(const [field,target]of Object.entries(fields))require(row[field]===null||ids.get(target)!.has(row[field]));
  parseLeadConversionCollection(sourceRows.conversions,sourceRows.links,businessId);
  const byId=(entity:string,id:unknown)=>rows[entity]!.find(row=>row.id===id)!;
  for(const link of rows.conversion_links!)require(link.lead_vehicle_id!==null?byId('lead_vehicles',link.lead_vehicle_id).lead_id===link.lead_id:byId('lead_addresses',link.lead_address_id).lead_id===link.lead_id&&byId('addresses',link.address_id).customer_id===byId('lead_conversions',link.conversion_id).customer_id);
  read('source_readme.txt');require(used.size===files.size);
  const crm=JSON.stringify({formatVersion:1,generationId:manifest.generationId,businessId,observedAt:manifest.observedAt,contexts,pages,evidenceBytes:crmBytes,recordCount:crmCount,completePortableExport:false,completeBackup:false});
  const value=freeze({formatVersion:1 as const,businessId,generationId:manifest.generationId,observedAt:manifest.observedAt,appReleaseId:manifest.appReleaseId,sourceSchemaVersion:42 as const,...serialized,crm,rows,csvSourceRowsVerified:true as const,rawSourceReconstructionVerified:true as const,assurance:'internal_consistency_only' as const,referenceClosureComplete:false as const,completePortableExport:false as const,completeBackup:false as const});
  return Object.freeze({forServer:()=>value,toJSON:()=>{throw new BusinessSourceVerificationError();}});
 }catch{throw new BusinessSourceVerificationError();}
}
