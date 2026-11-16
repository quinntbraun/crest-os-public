import 'server-only';
import {randomUUID} from 'node:crypto';
import {customerUuid} from '../customer/customer-contract.ts';
import {fieldSourceGroups} from './field-source-schema.ts';
import type {FieldSourceGroup} from './field-source-schema.ts';
import {FieldSourceError,verifyFieldSources} from './field-source.ts';
import type {FieldSourceInput} from './field-source.ts';
type Connection=Readonly<{query:(sql:string,args?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>}>;
// A dedicated export connection and a trusted fixed business scope are required.
// This owns exactly one held transaction. It is not owner/job/lease authority,
// a delivery endpoint, backup, automatic retry or a generic database reader.
async function captureFieldSources(connection:Connection,businessId:string,signal:AbortSignal,ownsTransaction:boolean){
 const deadline=performance.now()+30000;let open=false;
 const live=()=>{if(signal.aborted||performance.now()>=deadline)throw new FieldSourceError();};
 async function query(sql:string,args:unknown[]=[]){live();const result=await connection.query(sql,args);live();return result.rows;}
 async function value(sql:string,args:unknown[]=[]){const rows=await query(sql,args);if(rows.length!==1)throw new FieldSourceError();return rows[0]!.value as Record<string,unknown>;}
 try{
  if(!customerUuid(businessId))throw new FieldSourceError();live();
  if(ownsTransaction){open=true;await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   await query("SET LOCAL statement_timeout='10s'");await query("SET LOCAL idle_in_transaction_session_timeout='10s'");}
  const context=await value('SELECT crest_commands.field_source_context($1) value',[businessId]);
  const rows={} as Record<FieldSourceGroup,unknown[]>;
  for(const group of fieldSourceGroups){let after:string|null=null;const output:unknown[]=[];let done=false;
   for(let n=0;n<10001;n++){
    const page=await value('SELECT crest_commands.field_source_page($1,$2,$3,$4,20) value',[businessId,context.snapshotToken,group,after]);
    if(page.businessId!==businessId||page.snapshotToken!==context.snapshotToken||page.group!==group||page.schemaVersion!==1||!Array.isArray(page.rows)||page.rows.length>20||typeof page.hasMore!=='boolean')throw new FieldSourceError();
    for(const row of page.rows){if(row===null||typeof row!=='object'||!customerUuid(row.id)||after!==null&&row.id<=after)throw new FieldSourceError();output.push(row);after=row.id;}
    if(!page.hasMore){done=true;break;}if(!page.rows.length)throw new FieldSourceError();
   }if(!done)throw new FieldSourceError();rows[group]=output;
  }
  const historyContext=await value('SELECT crest_commands.business_history_export_context($1) value',[businessId]);if(historyContext.snapshotToken!==context.historySnapshotToken)throw new FieldSourceError();
  const records:Record<string,unknown>[]=[];let evidenceBytes=0;
  for(const kind of ['operation','audit_event']){let after:string|null=null,done=false;
   for(let n=0;n<10001;n++){
    const page=await query('SELECT * FROM crest_commands.business_history_export_page($1,$2,$3,$4,20)',[businessId,context.historySnapshotToken,kind,after]);
    if(!page.length){done=true;break;}for(const row of page){if(!customerUuid(row.record_id)||after!==null&&row.record_id<=after||typeof row.canonical_evidence!=='string')throw new FieldSourceError();evidenceBytes+=Buffer.byteLength(row.canonical_evidence);records.push({kind,recordId:row.record_id,representation:row.representation,canonicalEvidence:row.canonical_evidence,evidenceHash:row.evidence_hash});after=row.record_id;if(records.length>1000||evidenceBytes>8*1024*1024)throw new FieldSourceError();}
   }if(!done)throw new FieldSourceError();
  }
  const historyEvidence=JSON.stringify({formatVersion:1,assurance:'snapshot_bytes_only',generationId:randomUUID(),context:historyContext,evidenceBytes,records});
  const verified=verifyFieldSources({context,rows,historyEvidence});live();if(ownsTransaction){await query('COMMIT');open=false;}
  const source:FieldSourceInput=Object.freeze({context:verified.context,rows:verified.rows,historyEvidence});
  return Object.freeze({forServer:()=>source,toJSON():never{throw new FieldSourceError();}});
 }catch(error){if(open)await connection.query('ROLLBACK').catch(()=>{});if(error instanceof FieldSourceError)throw error;throw new FieldSourceError();}
}

export const collectFieldSources=(connection:Connection,businessId:string,signal:AbortSignal)=>captureFieldSources(connection,businessId,signal,true);
// For composition by the trusted owner of a single existing export snapshot.
// SQL independently refuses anything except RR READ ONLY. This variant never
// starts, commits or rolls back its caller's transaction; failures must abort
// the enclosing collection. It grants no connection or collection authority.
export const collectFieldSourcesInSnapshot=(connection:Connection,businessId:string,signal:AbortSignal)=>captureFieldSources(connection,businessId,signal,false);
