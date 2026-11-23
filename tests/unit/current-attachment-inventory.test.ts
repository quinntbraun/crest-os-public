import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {currentAttachmentInventory,formatCurrentAttachmentInventory} from '../../src/security/current-attachment-inventory';
import {currentBusinessSourceInventory} from '../../src/security/current-business-source-inventory';
import {imageValidationVersion} from '../../src/files/validation-contract';
import {createExportOriginalIndex} from '../../src/security/source-export-original-index';
import type {CurrentBusinessRows} from '../../src/security/current-business-source';
function fixture(){
 const businessId=randomUUID(),actor=randomUUID(),epoch=randomUUID(),stamp='2026-11-22T20:00:00.123456Z',expenseId=randomUUID(),receiptId=randomUUID(),photoId=randomUUID(),photoDispatch=randomUUID(),supplierId=randomUUID(),billId=randomUUID();
 const sources=currentBusinessSourceInventory.map(source=>({...source,types:Object.fromEntries(source.columns.map(column=>[column,'text'])),primaryKey:['id'],rows:[] as Record<string,string|null>[]}));
 function add(name:string,values:Record<string,string|null>){const source=sources.find(source=>source.source===name)!;const row:Record<string,string|null>=Object.fromEntries(source.columns.map(column=>[column,null]));Object.assign(row,{business_id:businessId},values);source.rows.push(row);return row;}
 function candidate(id:string,bytes=24){return{status:'PrivateValidatedCandidate',validationVersion:imageValidationVersion,source:{sha256:'a'.repeat(64),byteSize:bytes,detectedType:'image/png',width:1,height:1},original:{key:`originals/${businessId}/${id}`,byteSize:bytes,sha256:'a'.repeat(64)},preview:{key:`previews/${businessId}/${id}`,byteSize:4,sha256:'b'.repeat(64),contentType:'image/jpeg',width:1,height:1}};}
 add('crest.expense_revisions',{expense_id:expenseId,revision:'1',payload:JSON.stringify({voided:true})});
 const dispatch=randomUUID(),reservation={businessId,receiptId,expenseId,expenseRevision:'1',recoveryEpoch:epoch,declaredType:'image/png',byteSize:24,stagingKey:`staging/${businessId}/${receiptId}/${dispatch}`,originalKey:`originals/${businessId}/${receiptId}`,previewKey:`previews/${businessId}/${receiptId}`,dispatchId:dispatch};
 const base={receipt_id:receiptId,expense_id:expenseId,expense_revision:'1',actor_id:actor,recorded_at:stamp,reservation:JSON.stringify(reservation)};
 add('crest.expense_receipt_revisions',{...base,revision:'1',operation_id:randomUUID(),candidate:null});
 const receipt=add('crest.expense_receipt_revisions',{...base,revision:'2',operation_id:randomUUID(),candidate:JSON.stringify(candidate(receiptId))});
 const attempt=add('crest.custody_photo_attempts',{id:photoId,job_id:randomUUID(),job_vehicle_id:randomUUID(),vehicle_id:randomUUID(),case_id:randomUUID(),handoff_version:'1',actor_id:actor,recovery_epoch:epoch,dispatch_id:photoDispatch,declared_type:'image/png',byte_size:'24',reserved_at:stamp});
 const photo=add('crest.custody_photo_originals',{photo_id:photoId,detected_type:'image/png',byte_size:'24',sha256:'a'.repeat(64),validation_version:imageValidationVersion,width:'1',height:'1',preview_sha256:'b'.repeat(64),preview_byte_size:'4',preview_width:'1',preview_height:'1',verified_at:stamp});
 const documentReference="Supplier's =invoice\n001";
 add('crest.supplier_bill_draft_revisions',{bill_id:billId,revision:'9007199254740993',payload:JSON.stringify({documentReference})});
 const intent=add('crest.supplier_bill_original_intents',{id:supplierId,bill_id:billId,bill_revision:'9007199254740993',document_reference:documentReference,recovery_epoch:epoch,media_type:'image/png',byte_size:'24',dispatch_id:randomUUID(),operation_id:randomUUID(),created_by:actor,reserved_at:stamp});
 const supplier=add('crest.supplier_bill_originals',{id:supplierId,bill_id:billId,bill_revision:'9007199254740993',document_reference:documentReference,file_sha256:'a'.repeat(64),byte_size:'24',media_type:'image/png',object_key:`originals/${businessId}/${supplierId}`,verified_at:stamp,candidate:JSON.stringify(candidate(supplierId)),operation_id:randomUUID(),created_by:actor});
 function get(){return{schemaVersion:1,profile:'crest.current-business-rows.v1',businessId,snapshotToken:'c'.repeat(64),observedAt:stamp,sources,recordCount:sources.reduce((sum,source)=>sum+source.rows.length,0),completePortableExport:false,completeBackup:false} satisfies CurrentBusinessRows;}
 return{get,sources,add,receipt,attempt,photo,intent,supplier,businessId,receiptId,photoId,photoDispatch,supplierId,expenseId};
}
it('retains all three original kinds, exact references and the distinct photo dispatch object identity',()=>{
 const f=fixture(),inventory=currentAttachmentInventory(f.get());expect(inventory.availableCount).toBe(3);expect(inventory.pendingCount).toBe(0);
 const photo=inventory.attachments.find(item=>item.kind==='condition_photo')!;expect(photo.original!.path).toBe(`attachments/${f.photoId}/${f.photoDispatch}.png`);expect(photo.original!.objectId).not.toBe(f.photoId);
 expect(inventory.attachments.find(item=>item.kind==='supplier_document')!.references.billRevision).toBe('9007199254740993');expect(inventory.attachments.find(item=>item.kind==='expense_receipt')!.references.expenseId).toBe(f.expenseId);
 expect(inventory.attachments.every(item=>item.originalFilename===null&&item.delivery==='not_delivered')).toBe(true);expect(inventory.originalBytesIncluded).toBe(false);expect(inventory.completeBackup).toBe(false);
 const bundle=formatCurrentAttachmentInventory(f.get());expect(JSON.parse(Buffer.from(bundle.files['attachment_inventory.json']).toString())).toEqual(inventory);expect(Buffer.from(bundle.files['attachment_inventory_readme.txt']).toString()).toContain('No original file bytes');
});
it('keeps reservations explicit and never invents hashes or paths for unconfirmed bytes',()=>{
 const f=fixture();f.sources.find(source=>source.source==='crest.expense_receipt_revisions')!.rows.pop();f.sources.find(source=>source.source==='crest.custody_photo_originals')!.rows=[];f.sources.find(source=>source.source==='crest.supplier_bill_originals')!.rows=[];
 const result=currentAttachmentInventory(f.get());expect(result.pendingCount).toBe(3);expect(result.availableCount).toBe(0);expect(result.attachments.every(item=>item.original===null&&item.preview===null&&item.status==='reserved')).toBe(true);
});
it.each(['foreign business','orphan photo','orphan supplier','receipt hash','supplier hash','supplier key','changed reservation','unsupported media','duplicate receipt','missing expense','missing supplier draft','original size','photo size'])('refuses %s without publishing an incomplete inventory as complete',issue=>{
 const f=fixture();
 if(issue==='foreign business')f.photo.business_id=randomUUID();if(issue==='orphan photo')f.sources.find(source=>source.source==='crest.custody_photo_attempts')!.rows=[];
 if(issue==='orphan supplier')f.sources.find(source=>source.source==='crest.supplier_bill_original_intents')!.rows=[];
 if(issue==='receipt hash'){const candidate=JSON.parse(f.receipt.candidate!);candidate.original.sha256='b'.repeat(64);f.receipt.candidate=JSON.stringify(candidate);}
 if(issue==='supplier hash')f.supplier.file_sha256='b'.repeat(64);if(issue==='supplier key')f.supplier.object_key='originals/'+randomUUID()+'/'+f.supplierId;
 if(issue==='changed reservation'){const reservation=JSON.parse(f.receipt.reservation!);reservation.dispatchId=randomUUID();reservation.stagingKey=`staging/${f.businessId}/${f.receiptId}/${reservation.dispatchId}`;f.receipt.reservation=JSON.stringify(reservation);}
 if(issue==='unsupported media')f.attempt.declared_type='text/html';if(issue==='duplicate receipt')f.sources.find(source=>source.source==='crest.expense_receipt_revisions')!.rows.push({...f.receipt});
 if(issue==='missing expense')f.sources.find(source=>source.source==='crest.expense_revisions')!.rows=[];if(issue==='missing supplier draft')f.sources.find(source=>source.source==='crest.supplier_bill_draft_revisions')!.rows=[];
 if(issue==='original size')f.supplier.byte_size='25';if(issue==='photo size')f.photo.byte_size='25';
 expect(()=>currentAttachmentInventory(f.get())).toThrow();
});
it('rejects cross-kind attachment-path collisions instead of overwriting another original',()=>{const f=fixture();f.attempt.id=f.receiptId;f.photo.photo_id=f.receiptId;expect(()=>currentAttachmentInventory(f.get())).toThrow();});
it('represents an empty attachment snapshot without claiming bytes were delivered',()=>{const f=fixture();for(const source of f.sources)source.rows=[];const result=currentAttachmentInventory(f.get());expect(result.attachments).toEqual([]);expect(result.originalBytesIncluded).toBe(false);expect(result.completePortableExport).toBe(false);});
it('freezes exact inventory membership and preserves a retained timestamp beyond the capture clock',()=>{
 const f=fixture();f.receipt.recorded_at='2099-01-01T00:00:00.123456Z';const bundle=formatCurrentAttachmentInventory(f.get()),index=createExportOriginalIndex(bundle.inventory,bundle.files['attachment_inventory.json']);expect(index.files).toHaveLength(3);expect(index.files.find(file=>file.kind==='expense_receipt')!.recordedAt).toBe('2099-01-01T00:00:00.123456Z');expect(index.files.every(file=>bundle.inventory.attachments.some(item=>item.attachmentId===file.attachmentId))).toBe(true);
 const corrupt=Buffer.from(bundle.files['attachment_inventory.json']);corrupt[0]=0;expect(()=>createExportOriginalIndex(bundle.inventory,corrupt)).toThrow();
});
