// Private snapshot inventory for recovery tools. Published bytes and unresolved
// staging reservations are distinct. No object existence or coverage is inferred.
import {isDeepStrictEqual} from 'node:util';
import {isLiveRecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import {parseReceiptRecord,parseReceiptReservation,parseReceiptCandidate} from '../bookkeeping/expenses/receipt-contract.ts';

type Domain='expense_receipt'|'supplier_document'|'condition_photo';
export type RecoveryOriginalObject=Readonly<{domain:Domain;businessId:string;attachmentId:string;sourceTable:string;sourceIdentity:string;variant:'original'|'preview';key:string;byteSize:number;sha256:string;contentType:string;validationVersion:string}>;
type Staging=Readonly<{domain:Domain;businessId:string;attachmentId:string;key:string;declaredType:string;declaredByteSize:number;publication:'pending'|'published';bytesVerified:false}>;
export class RecoveryOriginalInventoryError extends Error{constructor(){super('RECOVERY_ORIGINAL_INVENTORY_REVIEW_REQUIRED');this.name='RecoveryOriginalInventoryError';}}
function require(value:unknown):asserts value{if(!value)throw new RecoveryOriginalInventoryError();}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const size=(value:unknown,maximum=26214400):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=maximum;
const media=['image/jpeg','image/png','image/heic','application/pdf'];

export async function captureRecoveryOriginalInventory(snapshot:RecoveryBackupSnapshot,signal:AbortSignal){
 try{
  require(isLiveRecoveryBackupSnapshot(snapshot));const objects:RecoveryOriginalObject[]=[],staging:Staging[]=[],seen=new Set<string>();let records=0,bytes=0;
  const query:RecoveryBackupSnapshot['query']=async(sql,values)=>{require(isLiveRecoveryBackupSnapshot(snapshot));signal.throwIfAborted();const result=await snapshot.query(sql,values);signal.throwIfAborted();return result;};
  await query('SET LOCAL search_path=pg_catalog');await query("SET LOCAL timezone='UTC'");
  const version=(await query('SELECT count(*)::integer AS count FROM supabase_migrations.schema_migrations')).rows[0]?.count;require(version===138||version===139);if(version===139){const last=(await query('SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1')).rows[0];require(last?.version==='20270205183000'&&last.name==='fictional_opening_funds_sources');}
  async function pages(sql:string,consume:(row:Record<string,unknown>)=>void){
   await query('DECLARE crest_recovery_originals NO SCROLL CURSOR FOR '+sql);
   try{for(;;){const page=(await query('FETCH FORWARD 100 FROM crest_recovery_originals')).rows;if(!page.length)break;for(const row of page){records++;bytes+=Buffer.byteLength(JSON.stringify(row));require(records<=100000&&bytes<=33554432);consume(row);}}}finally{await query('CLOSE crest_recovery_originals');}
  }
  function add(object:RecoveryOriginalObject){
   require(uuid(object.businessId)&&uuid(object.attachmentId)&&size(object.byteSize,object.variant==='preview'?8388608:26214400)&&/^[a-f0-9]{64}$/.test(object.sha256)&&media.includes(object.contentType)&&typeof object.validationVersion==='string'&&object.validationVersion.length<=256);
   require(new RegExp(`^${object.variant==='original'?'originals':'previews'}/${object.businessId}/[a-f0-9-]{36}$`).test(object.key));const identity=object.domain+':'+object.key;require(!seen.has(identity));seen.add(identity);objects.push(Object.freeze(object));require(objects.length<=100000);
  }
  function staged(domain:Domain,businessId:string,attachmentId:string,dispatchId:string,declaredType:string,declaredByteSize:number,published:boolean){
   require(uuid(businessId)&&uuid(attachmentId)&&uuid(dispatchId)&&media.includes(declaredType)&&size(declaredByteSize));staging.push(Object.freeze({domain,businessId,attachmentId,key:`staging/${businessId}/${attachmentId}/${dispatchId}`,declaredType,declaredByteSize,publication:published?'published':'pending',bytesVerified:false}));require(staging.length<=100000);
  }
  const receipts=new Map<string,ReturnType<typeof parseReceiptRecord>>();
  await pages(`SELECT business_id::text,receipt_id::text,revision::text,operation_id::text,actor_id::text,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,reservation,candidate FROM crest.expense_receipt_revisions ORDER BY business_id,receipt_id,revision`,row=>{
   require(uuid(row.business_id)&&uuid(row.receipt_id));const receipt=parseReceiptRecord({receiptVersion:row.revision,operationId:row.operation_id,actorId:row.actor_id,recordedAt:row.recorded_at,reservation:row.reservation,candidate:row.candidate},row.business_id,row.receipt_id),identity=row.business_id+':'+row.receipt_id,prior=receipts.get(identity);
   require(Number(receipt.receiptVersion)===Number(prior?.receiptVersion??'0')+1&&(!prior||isDeepStrictEqual(prior.reservation,receipt.reservation)));receipts.set(identity,receipt);
   const candidate=receipt.candidate;if(candidate)for(const variant of ['original','preview'] as const)add({domain:'expense_receipt',businessId:row.business_id,attachmentId:row.receipt_id,sourceTable:'crest.expense_receipt_revisions',sourceIdentity:row.receipt_id+':'+receipt.receiptVersion,variant,...candidate[variant],contentType:variant==='original'?receipt.reservation.declaredType:'image/jpeg',validationVersion:candidate.validationVersion});
  });
  for(const receipt of receipts.values()){const r=receipt.reservation;staged('expense_receipt',r.businessId,r.receiptId,r.dispatchId,r.declaredType,r.byteSize,receipt.candidate!==null);}
  require((await query('SELECT EXISTS(SELECT 1 FROM crest.supplier_bill_originals o LEFT JOIN crest.supplier_bill_original_intents i ON i.business_id=o.business_id AND i.id=o.id WHERE i.id IS NULL) AS orphan')).rows[0]?.orphan===false);
  await pages("SELECT to_jsonb(i)||jsonb_build_object('bill_revision',i.bill_revision::text) AS intent,CASE WHEN o.id IS NULL THEN NULL ELSE to_jsonb(o)||jsonb_build_object('bill_revision',o.bill_revision::text) END AS original FROM crest.supplier_bill_original_intents i LEFT JOIN crest.supplier_bill_originals o ON o.business_id=i.business_id AND o.id=i.id ORDER BY i.business_id,i.id",row=>{
   const i=row.intent as Record<string,unknown>,o=row.original as Record<string,unknown>|null;require(i&&uuid(i.business_id)&&uuid(i.id)&&uuid(i.dispatch_id)&&typeof i.bill_revision==='string'&&/^[1-9][0-9]*$/.test(i.bill_revision));
   const r=parseReceiptReservation({businessId:i.business_id,receiptId:i.id,expenseId:i.bill_id,expenseRevision:String(i.bill_revision),recoveryEpoch:i.recovery_epoch,declaredType:i.media_type,byteSize:i.byte_size,dispatchId:i.dispatch_id,stagingKey:`staging/${i.business_id}/${i.id}/${i.dispatch_id}`,originalKey:`originals/${i.business_id}/${i.id}`,previewKey:`previews/${i.business_id}/${i.id}`});staged('supplier_document',r.businessId,r.receiptId,r.dispatchId,r.declaredType,r.byteSize,o!==null);
   if(o){const c=parseReceiptCandidate(o.candidate,r);require(o.bill_id===i.bill_id&&o.bill_revision===i.bill_revision&&o.document_reference===i.document_reference&&o.object_key===c.original.key&&o.file_sha256===c.original.sha256&&o.byte_size===c.original.byteSize&&o.media_type===c.source.detectedType);for(const variant of ['original','preview'] as const)add({domain:'supplier_document',businessId:r.businessId,attachmentId:r.receiptId,sourceTable:'crest.supplier_bill_originals',sourceIdentity:r.receiptId,variant,...c[variant],contentType:variant==='original'?r.declaredType:'image/jpeg',validationVersion:c.validationVersion});}
  });
  require((await query('SELECT EXISTS(SELECT 1 FROM crest.custody_photo_originals o LEFT JOIN crest.custody_photo_attempts a ON a.business_id=o.business_id AND a.id=o.photo_id WHERE a.id IS NULL) AS orphan')).rows[0]?.orphan===false);
  await pages('SELECT to_jsonb(a) AS attempt,to_jsonb(o) AS original FROM crest.custody_photo_attempts a LEFT JOIN crest.custody_photo_originals o ON o.business_id=a.business_id AND o.photo_id=a.id ORDER BY a.business_id,a.id',row=>{
   const a=row.attempt as Record<string,unknown>,o=row.original as Record<string,unknown>|null;require(a&&uuid(a.business_id)&&uuid(a.id)&&uuid(a.dispatch_id)&&typeof a.declared_type==='string'&&size(a.byte_size));staged('condition_photo',a.business_id,a.id,a.dispatch_id,a.declared_type,a.byte_size,o!==null);
   if(o){require(o.business_id===a.business_id&&o.photo_id===a.id&&o.byte_size===a.byte_size&&o.detected_type===a.declared_type&&typeof o.validation_version==='string'&&typeof o.sha256==='string'&&typeof o.preview_sha256==='string'&&size(o.preview_byte_size,8388608));for(const variant of ['original','preview'] as const)add({domain:'condition_photo',businessId:a.business_id,attachmentId:a.id,sourceTable:'crest.custody_photo_originals',sourceIdentity:a.id,variant,key:`${variant==='original'?'originals':'previews'}/${a.business_id}/${a.dispatch_id}`,byteSize:variant==='original'?a.byte_size:o.preview_byte_size,sha256:variant==='original'?o.sha256:o.preview_sha256,contentType:variant==='original'?a.declared_type:'image/jpeg',validationVersion:o.validation_version});}
  });
  const order=(a:{domain:string;key:string},b:{domain:string;key:string})=>Buffer.compare(Buffer.from(a.domain+':'+a.key),Buffer.from(b.domain+':'+b.key));objects.sort(order);staging.sort(order);
  const evidence=Object.freeze({profile:'crest.private-original-inventory.v1' as const,snapshotId:snapshot.id,scope:'all-businesses-published-receipts-supplier-documents-condition-photos' as const,objects:Object.freeze(objects),stagingReservations:Object.freeze(staging),pendingCount:staging.filter(item=>item.publication==='pending').length,stagingBytesInventoried:false as const,retainedUnpublishedCandidatesInventoried:false as const,originalBytesIncluded:false as const,completeBackup:false as const});
  return Object.freeze({forRecoveryTools:()=>evidence,toJSON():never{throw new RecoveryOriginalInventoryError();}});
 }catch{throw new RecoveryOriginalInventoryError();}
}
