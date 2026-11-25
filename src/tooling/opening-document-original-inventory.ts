// Held source142 collector. The caller owns the consistent, authorized snapshot
// and combines these rows with the other domains before archiving any bytes.
import {parseOpeningDocumentRecord} from '../bookkeeping/opening-document-workflow.ts';
import type {RecoveryBackupSnapshot} from './recovery-backup-lease.ts';
import type {RecoveryOriginalObject} from './recovery-original-inventory.ts';

export type OpeningDocumentStaging=Readonly<{domain:'supplier_document';businessId:string;attachmentId:string;key:string;declaredType:string;declaredByteSize:number;publication:'pending'|'published';bytesVerified:false}>;
export class OpeningDocumentInventoryError extends Error{constructor(){super('OPENING_DOCUMENT_INVENTORY_REVIEW_REQUIRED');this.name='OpeningDocumentInventoryError';}}
function require(value:unknown):asserts value{if(!value)throw new OpeningDocumentInventoryError();}

export async function collectOpeningDocumentOriginalInventory(
 query:RecoveryBackupSnapshot['query'],signal:AbortSignal,
 consume:Readonly<{object(value:RecoveryOriginalObject):void;staging(value:OpeningDocumentStaging):void}>,
){
 const run:RecoveryBackupSnapshot['query']=async(sql,values)=>{signal.throwIfAborted();const result=await query(sql,values);signal.throwIfAborted();return result;};
 try{
  require((await run('SELECT EXISTS(SELECT 1 FROM crest.opening_document_originals o LEFT JOIN crest.opening_document_intents i ON i.business_id=o.business_id AND i.id=o.id WHERE i.id IS NULL) AS orphan')).rows[0]?.orphan===false);
  await run('DECLARE crest_opening_document_originals NO SCROLL CURSOR FOR SELECT to_jsonb(i) AS intent,to_jsonb(o) AS original FROM crest.opening_document_intents i LEFT JOIN crest.opening_document_originals o ON o.business_id=i.business_id AND o.id=i.id ORDER BY i.business_id,i.id');
  let records=0,metadataBytes=0,objects=0,pending=0;const seen=new Set<string>();
  try{
   for(;;){
    const rows=(await run('FETCH FORWARD 100 FROM crest_opening_document_originals')).rows;require(rows.length<=100);if(!rows.length)break;
    for(const row of rows){
     signal.throwIfAborted();records++;metadataBytes+=Buffer.byteLength(JSON.stringify(row));require(records<=100000&&metadataBytes<=33554432);
     const i=row.intent as Record<string,unknown>,o=row.original as Record<string,unknown>|null;
     require(i&&typeof i.business_id==='string'&&typeof i.id==='string'&&(o===null||o&&o.business_id===i.business_id&&o.id===i.id&&o.candidate!==null&&typeof o.candidate==='object'));
     const identity=i.business_id+':'+i.id;require(!seen.has(identity));seen.add(identity);
     const record=parseOpeningDocumentRecord({state:'ready',schemaVersion:1,reservation:{businessId:i.business_id,documentId:i.id,reference:i.reference,sha256:i.expected_sha256,recoveryEpoch:i.recovery_epoch,declaredType:i.media_type,byteSize:i.byte_size,dispatchId:i.dispatch_id,stagingKey:`staging/${i.business_id}/${i.id}/${i.dispatch_id}`,originalKey:`originals/${i.business_id}/${i.id}`,previewKey:`previews/${i.business_id}/${i.id}`},candidate:o===null?null:o.candidate},i.business_id,i.id),r=record.reservation;
     consume.staging(Object.freeze({domain:'supplier_document',businessId:r.businessId,attachmentId:r.receiptId,key:r.stagingKey,declaredType:r.declaredType,declaredByteSize:r.byteSize,publication:record.candidate?'published':'pending',bytesVerified:false}));
     if(!record.candidate){pending++;continue;}
     for(const variant of ['original','preview'] as const){
      signal.throwIfAborted();
      consume.object(Object.freeze({domain:'supplier_document',businessId:r.businessId,attachmentId:r.receiptId,sourceTable:'crest.opening_document_originals',sourceIdentity:r.receiptId,variant,...record.candidate[variant],contentType:variant==='original'?r.declaredType:'image/jpeg',validationVersion:record.candidate.validationVersion}));objects++;
     }
    }
   }
  }finally{await query('CLOSE crest_opening_document_originals');}
  return Object.freeze({records,objects,pending,originalBytesIncluded:false as const,completeBackup:false as const});
 }catch{throw new OpeningDocumentInventoryError();}
}
