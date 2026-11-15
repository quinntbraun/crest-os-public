import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {customerUuid,exactCustomerObject as exact} from '../../customer/customer-contract.ts';
import {parseSupplierBillDraftRevision} from './supplier-bill-draft-contract.ts';

type Row=Readonly<Record<string,unknown>>;
type History=Readonly<{operation:readonly Row[];audit_event:readonly Row[]}>;
const command='bookkeeping.supplier_bill.save';
const entity='supplier_bill_draft_revisions';
export const supplierBillDraftFile='supplier_bill_draft_source.json';
export const supplierBillDraftSourceCoverage={table:'crest.supplier_bill_draft_revisions',scope:'business',
 required:['business_id','bill_id','revision','previous_revision','operation_id','actor_id','recorded_at','payload'],
 excluded:[],partialEvidenceGroup:null} as const;
export const isSupplierBillDraftOperation=(row:Row)=>row.command_type===command;

function check(value:unknown):asserts value{
 if(!value)throw Error('SUPPLIER_BILL_DRAFT_SOURCE_REQUIRED');
}
function json(value:unknown){
 check(typeof value==='string'&&Buffer.byteLength(value)<=4194304);
 return JSON.parse(value) as unknown;
}
export function verifySupplierBillDraftSource(value:unknown,businessId:string,history:History){
 check(exact(value,['schemaVersion','scope','businessId','revisions'])&&value.schemaVersion===1
  &&value.scope==='supplier_bill_draft_source'&&value.businessId===businessId&&customerUuid(businessId)
  &&Array.isArray(value.revisions)&&value.revisions.length<=400&&Buffer.byteLength(JSON.stringify(value))<=4194304);
 const stored=history.operation.filter(isSupplierBillDraftOperation);
 const recorded=history.audit_event.filter(row=>row.entity_kind===entity);
 const operations=new Map(stored.map(row=>[row.operation_id,row]));
 const audits=new Map(recorded.map(row=>[row.operation_id,row]));
 check(operations.size===stored.length&&audits.size===recorded.length&&operations.size===audits.size
  &&operations.size===value.revisions.length);
 let prior:ReturnType<typeof parseSupplierBillDraftRevision>|null=null;
 for(const entry of value.revisions){
  const draft=parseSupplierBillDraftRevision(entry,businessId);
  check(!prior||draft.billId>=prior.billId);
  if(prior?.billId!==draft.billId)prior=null;
  check(BigInt(draft.revision)===BigInt(prior?.revision??'0')+1n);
  const operation=operations.get(draft.operationId),audit=audits.get(draft.operationId);
  const delta={schemaVersion:1,before:prior,after:draft};
  check(operation&&audit&&operation.business_id===businessId&&operation.actor_id===draft.actorId
   &&operation.state==='committed'&&operation.origin==='manual'&&operation.import_row_id===null
   &&String(operation.schema_version)==='1'&&String(operation.result_schema_version)==='1'
   &&isDeepStrictEqual(json(operation.result),{schemaVersion:1,draft})
   &&audit.business_id===businessId&&audit.actor_id===draft.actorId&&audit.entity_id===draft.billId
   &&String(audit.entity_version)===draft.revision&&audit.action===(prior?'revise':'create')
   &&audit.reason===draft.payload.changeReason&&isDeepStrictEqual(json(audit.delta),delta)
   &&typeof audit.hash_input==='string'&&audit.hash_input===audit.payload
   &&createHash('sha256').update(audit.hash_input).digest('hex')===audit.event_hash);
  const payload=json(audit.payload);
  check(payload&&typeof payload==='object'&&'delta' in payload&&isDeepStrictEqual(payload.delta,delta)
   &&'operationId' in payload&&payload.operationId===draft.operationId);
  prior=draft;
  operations.delete(draft.operationId);
  audits.delete(draft.operationId);
 }
 check(!operations.size&&!audits.size);
}

export async function captureSupplierBillDraftSource(businessId:string,query:(sql:string,args:unknown[])=>Promise<unknown[]>){
 const rows=await query('SELECT crest_commands.supplier_bill_draft_source_snapshot($1::uuid) AS result',[businessId]);
 check(rows.length===1&&exact(rows[0],['result']));
 return rows[0].result;
}
