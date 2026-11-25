// Private held-domain export. This never creates application data or authority.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {readCurrentBusinessCsv,currentSourceCsvScalarFormat} from '../security/current-business-source-csv.ts';
import {verifyOpeningFundsEvidence} from './opening-funds-evidence.ts';
type Row=Record<string,unknown>;
type Parents=Readonly<{worksheetCutovers:ReadonlyMap<string,string>;customerIds:ReadonlySet<string>}>;
import {openingFundsSourceColumns as columns} from './opening-funds-source-columns.ts';
export {openingFundsSourceCoverage} from './opening-funds-source-columns.ts';
const save='finance.opening_funds.save',retire='finance.opening_funds.retire';
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
function check(value:unknown):asserts value{if(!value)throw Error('OPENING_FUNDS_SOURCE_REVIEW_REQUIRED');}
function row(value:unknown):Row{check(value&&typeof value==='object'&&!Array.isArray(value));return value as Row;}
function json(value:unknown):unknown{check(typeof value==='string'&&Buffer.byteLength(value)<=33554432);return JSON.parse(value);}
function instant(value:unknown){check(typeof value==='string');const match=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);check(match);return match[1]+'.'+(match[2]??'').padEnd(6,'0')+'Z';}
function index(value:unknown,fields:readonly string[],business:string,key='id',limit=100000){
 check(Array.isArray(value)&&value.length<=limit);const result=new Map<string,Row>(),ids=new Set<string>();let previous='';
 for(const input of value){check(exact(input,fields)&&input.business_id===business&&customerUuid(input.id)&&customerUuid(input[key])&&String(input[key])>previous&&!ids.has(String(input.id)));ids.add(String(input.id));previous=String(input[key]);result.set(previous,input);}
 return result;
}
export function buildOpeningFundsSourceFiles(value:unknown,business:string,parents:Parents){
 check(customerUuid(business)&&exact(value,['schemaVersion','profile','catalogRegistered','businessId','origins','items','revisions','completeBusinessExport','operations','audits'])&&value.schemaVersion===1&&value.profile==='crest.opening-funds-source-candidate.v2'&&value.catalogRegistered===false&&value.businessId===business&&value.completeBusinessExport===false&&Buffer.byteLength(JSON.stringify(value))<=33554432);
 const origins=index(value.origins,columns.origins,business,'id',20000),items=index(value.items,columns.items,business);
 const operations=index(value.operations,columns.operations,business,'operation_id',1000),audits=index(value.audits,columns.audits,business,'operation_id',1000);
 check(operations.size===audits.size&&Array.isArray(value.revisions)&&value.revisions.length<=100);
 const external=new Set<string>(),usedOrigins=new Set<string>(),usedItems=new Set<string>(),saved=new Set<string>(),ids=new Set<string>(),latest=new Map<string,Row>(),creatingOrigins=new Set<string>(),creatingItems=new Set<string>();
 const data:Record<keyof typeof columns,Row[]>={origins:[...origins.values()],items:[...items.values()],revisions:[],operations:[...operations.values()],audits:[...audits.values()]};
 for(const origin of origins.values()){
  check(customerUuid(origin.operation_id)&&customerUuid(origin.recorded_by)&&typeof origin.source_namespace==='string'&&/^[a-z][a-z0-9_.-]{0,99}$/.test(origin.source_namespace)&&typeof origin.external_id==='string');instant(origin.recorded_at);
  const key=JSON.stringify([origin.source_namespace,origin.external_id]);check(!external.has(key));external.add(key);
 }
 for(const item of items.values()){check(customerUuid(item.origin_id)&&origins.has(item.origin_id)&&customerUuid(item.customer_id)&&parents.customerIds.has(item.customer_id)&&customerUuid(item.operation_id)&&customerUuid(item.recorded_by));instant(item.recorded_at);}
 for(const operation of operations.values()){
  const audit=audits.get(String(operation.operation_id));check(operation.command_type===save||operation.command_type===retire);
  check(operation.schema_version==='1'&&operation.result_schema_version==='1'&&operation.state==='committed'&&operation.origin==='manual'&&operation.import_row_id===null&&customerUuid(operation.actor_id)&&operation.created_by===operation.actor_id&&customerUuid(operation.recovery_epoch)&&typeof operation.payload_hash==='string'&&/^[a-f0-9]{64}$/.test(operation.payload_hash));
  check(audit&&audit.actor_id===operation.actor_id&&audit.created_by===operation.actor_id&&audit.origin==='manual'&&audit.import_row_id===null&&typeof audit.reason==='string');instant(operation.committed_at);instant(operation.created_at);instant(audit.recorded_at);instant(audit.created_at);
 }
 for(const entry of value.revisions){
  check(exact(entry,['row','receipt','evidenceText']));const record=row(entry.row),receipt=row(entry.receipt);check(exact(record,columns.revisions)&&record.business_id===business&&customerUuid(record.id)&&!ids.has(record.id));ids.add(record.id);
  check(exact(receipt,['schemaVersion','businessId','scheduleRevisionId','worksheetRevisionId','revision','operationId','auditEventId','recordedBy','recordedAt','evidenceSha256','evidence'])&&receipt.schemaVersion===1&&receipt.businessId===business&&receipt.scheduleRevisionId===record.id&&receipt.worksheetRevisionId===record.worksheet_revision_id&&receipt.revision===record.revision&&receipt.operationId===record.operation_id&&receipt.auditEventId===record.audit_event_id&&receipt.recordedBy===record.recorded_by&&instant(receipt.recordedAt)===instant(record.recorded_at)&&receipt.evidenceSha256===record.evidence_sha256);
  check(typeof entry.evidenceText==='string'&&hash(entry.evidenceText)===record.evidence_sha256&&isDeepStrictEqual(json(entry.evidenceText),record.evidence)&&isDeepStrictEqual(record.evidence,receipt.evidence));
  const evidence=verifyOpeningFundsEvidence(receipt.evidence);check(customerUuid(record.worksheet_revision_id)&&parents.worksheetCutovers.get(record.worksheet_revision_id)===evidence.cutoverOn&&typeof record.revision==='string'&&/^[1-9][0-9]{0,18}$/.test(record.revision)&&BigInt(record.revision)<=9223372036854775807n);
  const previous=latest.get(record.worksheet_revision_id)??null;check(BigInt(record.revision)===BigInt(previous?String(previous.revision):'0')+1n&&record.prior_revision===(previous?previous.revision:null));
  const operation=operations.get(String(record.operation_id)),audit=audits.get(String(record.operation_id));check(operation?.command_type===save&&operation.actor_id===record.recorded_by&&!saved.has(String(record.operation_id))&&isDeepStrictEqual(json(operation.result),receipt)&&audit&&audit.id===record.audit_event_id&&audit.entity_kind==='opening_funds_schedule_revisions'&&audit.entity_id===record.id&&audit.entity_version===record.revision&&audit.action==='review'&&audit.reason===evidence.reason&&isDeepStrictEqual(json(audit.delta),{schemaVersion:1,before:previous,after:receipt}));
  for(const source of evidence.roots){
   const origin=origins.get(source.rootId);check(origin&&origin.source_namespace===source.sourceNamespace&&origin.external_id===source.externalId);usedOrigins.add(source.rootId);
   if(origin.operation_id===record.operation_id){check(origin.recorded_by===record.recorded_by);creatingOrigins.add(source.rootId);}
   for(const obligation of source.items){const item=items.get(obligation.itemId);check(item&&item.origin_id===source.rootId&&item.customer_id===obligation.customerId);usedItems.add(obligation.itemId);if(item.operation_id===record.operation_id){check(item.recorded_by===record.recorded_by);creatingItems.add(obligation.itemId);}}
  }
  latest.set(record.worksheet_revision_id,receipt);saved.add(String(record.operation_id));data.revisions.push({...record,evidence:entry.evidenceText});
 }
 check(usedOrigins.size===origins.size&&usedItems.size===items.size&&creatingOrigins.size===origins.size&&creatingItems.size===items.size);
 for(const[id,operation]of operations){if(operation.command_type===save){check(saved.has(id));continue;}const decision=row(json(operation.result)),audit=audits.get(id);check(decision.schemaVersion===1&&decision.state==='retired'&&decision.businessId===business&&decision.operationId===id&&customerUuid(decision.originalEpoch)&&customerUuid(decision.reviewEpoch)&&decision.reviewEpoch===operation.recovery_epoch&&audit&&audit.id===decision.auditEventId&&audit.entity_kind==='operations'&&audit.entity_id===operation.id&&audit.entity_version==='1'&&audit.action==='retire'&&isDeepStrictEqual(json(audit.delta),{schemaVersion:1,before:null,after:decision}));}
 const files:Record<string,Uint8Array>={},dictionary:Record<string,unknown>={},escapeMap:Record<string,unknown>={};const quote=(text:string)=>'"'+text.replaceAll('"','""')+'"';
 const sql:string[]=['-- Neutral inspection only: no sessions, active application schema or posting authority.','BEGIN;','SET LOCAL search_path=pg_catalog;',"SET LOCAL standard_conforming_strings=on;",'CREATE SCHEMA crest_opening_funds_source;'];
 const literal=(input:string|null)=>input===null?'NULL':"E'"+input.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
 for(const name of Object.keys(columns) as (keyof typeof columns)[]){
  const fields=columns[name],rows=data[name].map(item=>Object.fromEntries(fields.map(field=>{const cell=item[field];check(cell===null||typeof cell==='string');return[field,cell];})) as Record<string,string|null>),flags:{row:number;column:string}[]=[];
  const csv=[fields.map(quote).join(','),...rows.map((item,index)=>fields.map(field=>{const input=item[field]!;if(input===null)return quote('\\N');let cell=input.replaceAll('\\','\\\\');if(cell.startsWith("'")||['=','+','-','@'].includes(cell.trimStart()[0]??'')){cell="'"+cell;flags.push({row:index+1,column:field});}return quote(cell);}).join(','))].join('\r\n')+'\r\n';
  check(isDeepStrictEqual(readCurrentBusinessCsv(csv,fields,flags),rows));const file=name+'.csv';files[file]=Buffer.from(csv);dictionary[file]={columns:fields,records:rows.length,excluded:[]};escapeMap[file]=flags;
  const table='crest_opening_funds_source.'+quote(name);sql.push('CREATE TABLE '+table+' ('+fields.map(field=>quote(field)+' text').join(',')+', PRIMARY KEY (id));');for(const item of rows)sql.push('INSERT INTO '+table+' VALUES ('+fields.map(field=>literal(item[field]!)).join(',')+');');
 }
 sql.push('ALTER TABLE crest_opening_funds_source.operations ADD UNIQUE(business_id,operation_id);','ALTER TABLE crest_opening_funds_source.origins ADD UNIQUE(business_id,id);','ALTER TABLE crest_opening_funds_source.revisions ADD UNIQUE(business_id,worksheet_revision_id,revision);');
 for(const [table,from,target,to]of [['items','business_id,origin_id','origins','business_id,id'],['origins','business_id,operation_id','operations','business_id,operation_id'],['items','business_id,operation_id','operations','business_id,operation_id'],['revisions','business_id,operation_id','operations','business_id,operation_id'],['audits','business_id,operation_id','operations','business_id,operation_id'],['revisions','audit_event_id','audits','id'],['revisions','business_id,worksheet_revision_id,prior_revision','revisions','business_id,worksheet_revision_id,revision']])sql.push('ALTER TABLE crest_opening_funds_source.'+table+' ADD FOREIGN KEY ('+from+') REFERENCES crest_opening_funds_source.'+target+' ('+to+');');
 sql.push('COMMIT;');files['reimport.sql']=Buffer.from(sql.join('\n')+'\n');files['source.json']=Buffer.from(JSON.stringify(value)+'\n');files['dictionary.json']=Buffer.from(JSON.stringify(dictionary)+'\n');files['escape_map.json']=Buffer.from(JSON.stringify(escapeMap)+'\n');
 files['manifest.json']=Buffer.from(JSON.stringify({profile:'crest.opening-funds-files-candidate.v1',businessId:business,catalogRegistered:false,scalarFormat:currentSourceCsvScalarFormat,completeBusinessExport:false,completeBackup:false,externalParents:['business','actors','customers','opening worksheets'],files:Object.entries(files).map(([name,bytes])=>({name,byteSize:bytes.byteLength,sha256:hash(bytes)}))})+'\n');
 check(Object.values(files).reduce((sum,bytes)=>sum+bytes.byteLength,0)<=67108864);return files;
}
