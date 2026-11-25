import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {parseReceiptRecord,parseReceiptReservation,parseReceiptCandidate} from '../bookkeeping/expenses/receipt-contract.ts';
import {photoStatus} from '../operations/dropoff-photo-workflow.ts';
import {customerUuid as uuid} from '../customer/customer-contract.ts';
import {currentBusinessInventoryForProfile} from './current-business-source-inventory.ts';
import {parseOpeningDocumentRecord} from '../bookkeeping/opening-document-workflow.ts';
import type {CurrentBusinessRows} from './current-business-source.ts';

type Kind='expense_receipt'|'supplier_document'|'condition_photo';
type ObjectMetadata=Readonly<{objectId:string;path:string;mediaType:string;byteSize:number;sha256:string}>;
export type CurrentAttachment=Readonly<{
 attachmentId:string;kind:Kind;status:'reserved'|'available';sourceTable:string;
 mediaType:string;byteSize:number;recordedAt:string;references:Readonly<Record<string,string|null>>;
 original:ObjectMetadata|null;preview:ObjectMetadata|null;
 originalFilename:null;originalFilenameStatus:'not_retained_by_source';delivery:'not_delivered';
}>;
function require(value:unknown):asserts value{if(!value)throw Error('CURRENT_ATTACHMENT_INVENTORY_REVIEW_REQUIRED');}
const exact=(value:unknown,keys:readonly string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const media=new Map([['image/jpeg','jpg'],['image/png','png'],['image/heic','heic'],['application/pdf','pdf']]);
function integer(value:string|null|undefined,maximum:number){require(typeof value==='string'&&/^[1-9][0-9]*$/.test(value));const n=Number(value);require(Number.isSafeInteger(n)&&n<=maximum);return n;}
function text(value:string|null|undefined):string{require(typeof value==='string'&&!value.includes('\0')&&Buffer.from(value).toString('utf8')===value);return value;}
function json(value:string|null|undefined):unknown{const encoded=text(value);require(Buffer.byteLength(encoded)<=4194304);return JSON.parse(encoded);}
function unique<T>(rows:readonly T[],key:(row:T)=>string){const map=new Map<string,T>();for(const row of rows){const id=key(row);require(!map.has(id));map.set(id,row);}return map;}
function metadata(id:string,objectId:string,type:string,byteSize:number,sha256:string,preview=false):ObjectMetadata{
 require(uuid(id)&&uuid(objectId)&&media.has(type)&&byteSize>=1&&Number.isSafeInteger(byteSize)&&byteSize<=(preview?8388608:26214400)&&/^[a-f0-9]{64}$/.test(sha256));
 return Object.freeze({objectId,path:`${preview?'previews':'attachments'}/${id}/${objectId}.${media.get(type)}`,mediaType:type,byteSize,sha256});
}
// Inventory and source consistency only. This neither authorizes an object read
// nor proves that a file exists, has been downloaded, or is in a backup vault.
export function currentAttachmentInventory(capture:CurrentBusinessRows){
 const selected=currentBusinessInventoryForProfile(capture.profile);require(selected);const inventory=selected;
 require(capture.schemaVersion===1&&(capture.profile==='crest.current-business-rows.v1'||capture.profile==='crest.current-business-rows.v2'||capture.profile==='crest.current-business-rows.v3'||capture.profile==='crest.current-business-rows.v4')&&uuid(capture.businessId)&&/^[a-f0-9]{64}$/.test(capture.snapshotToken)&&capture.completePortableExport===false&&capture.completeBackup===false&&capture.sources.length===inventory.length);
 const sources=unique(capture.sources,value=>value.source);require(capture.recordCount===capture.sources.reduce((sum,source)=>sum+source.rows.length,0)&&capture.recordCount<=100000);
 function rows(name:string){
  const source=sources.get(name),expected=inventory.find(value=>value.source===name);require(source&&expected&&isDeepStrictEqual(source.columns,expected.columns));
  for(const row of source.rows)require(exact(row,source.columns)&&source.columns.every(key=>row[key]===null||typeof row[key]==='string')&&row.business_id===capture.businessId);
  return source.rows;
 }
 const result:CurrentAttachment[]=[],paths=new Set<string>(),attachmentIds=new Set<string>();
 function add(item:CurrentAttachment){
  require(uuid(item.attachmentId)&&!attachmentIds.has(item.attachmentId)&&media.has(item.mediaType));attachmentIds.add(item.attachmentId);
  require(typeof item.recordedAt==='string'&&Number.isFinite(Date.parse(item.recordedAt)));
  for(const object of[item.original,item.preview])if(object){require(!paths.has(object.path));paths.add(object.path);}
  require((item.status==='available')===(item.original!==null&&item.preview!==null));result.push(Object.freeze({...item,references:Object.freeze({...item.references})}));require(result.length<=100000);
 }
 const defaults={originalFilename:null,originalFilenameStatus:'not_retained_by_source',delivery:'not_delivered'} as const;
 const expenses=unique(rows('crest.expense_revisions'),row=>text(row.expense_id)+':'+text(row.revision));
 const receiptRows=rows('crest.expense_receipt_revisions').map(row=>{
  const value=parseReceiptRecord({receiptVersion:row.revision,operationId:row.operation_id,actorId:row.actor_id,recordedAt:row.recorded_at,reservation:json(row.reservation),candidate:row.candidate===null?null:json(row.candidate)},capture.businessId,text(row.receipt_id));
  require(row.expense_id===value.reservation.expenseId&&row.expense_revision===value.reservation.expenseRevision&&expenses.has(text(row.expense_id)+':'+text(row.expense_revision)));return value;
 }).sort((a,b)=>a.reservation.receiptId<b.reservation.receiptId?-1:a.reservation.receiptId>b.reservation.receiptId?1:Number(a.receiptVersion)-Number(b.receiptVersion));
 const latest=new Map<string,typeof receiptRows[number]>();
 for(const receipt of receiptRows){const id=receipt.reservation.receiptId,previous=latest.get(id);require(Number(receipt.receiptVersion)===Number(previous?.receiptVersion??'0')+1&&(!previous||isDeepStrictEqual(previous.reservation,receipt.reservation)));latest.set(id,receipt);}
 for(const receipt of latest.values()){
  const r=receipt.reservation,c=receipt.candidate;add({...defaults,attachmentId:r.receiptId,kind:'expense_receipt',status:c?'available':'reserved',sourceTable:'crest.expense_receipt_revisions',mediaType:r.declaredType,byteSize:r.byteSize,recordedAt:receipt.recordedAt,references:{expenseId:r.expenseId,expenseRevision:r.expenseRevision,receiptRevision:receipt.receiptVersion},
   original:c?metadata(r.receiptId,r.receiptId,c.source.detectedType,c.original.byteSize,c.original.sha256):null,preview:c?metadata(r.receiptId,r.receiptId,'image/jpeg',c.preview.byteSize,c.preview.sha256,true):null});
 }
 const photoOriginals=unique(rows('crest.custody_photo_originals'),row=>text(row.photo_id)),attempts=unique(rows('crest.custody_photo_attempts'),row=>text(row.id)),slots=unique(rows('crest_private.pickup_photo_slots'),row=>text(row.photo_id));
 for(const id of photoOriginals.keys())require(attempts.has(id));
 for(const [id,attempt]of attempts){
  const scope={businessId:capture.businessId,jobVehicleId:text(attempt.job_vehicle_id),photoId:id},original=photoOriginals.get(id),numbers=['byte_size','width','height','display_width','display_height','bit_depth','preview_byte_size','preview_width','preview_height'];
  const reservation={...attempt,byte_size:integer(attempt.byte_size,26214400),handoff_version:integer(attempt.handoff_version,2)},verified=original?Object.fromEntries(Object.entries(original).map(([key,value])=>[key,numbers.includes(key)&&value!==null?integer(value,60000000):value])):null;
  const status=photoStatus({reservation,original:verified,linked:false},scope),slot=slots.get(id);require(status==='pending'||status==='verified');
  if(slot)require(slot.job_id===attempt.job_id&&slot.job_vehicle_id===attempt.job_vehicle_id);
  add({...defaults,attachmentId:id,kind:'condition_photo',status:original?'available':'reserved',sourceTable:'crest.custody_photo_attempts',mediaType:text(attempt.declared_type),byteSize:reservation.byte_size,recordedAt:original?text(original.verified_at):text(attempt.reserved_at),references:{jobId:text(attempt.job_id),jobVehicleId:text(attempt.job_vehicle_id),vehicleId:text(attempt.vehicle_id),caseId:attempt.case_id??null,pickupCollectionId:slot?.collection_id??null,returnCollectionId:slot?.return_collection_id??null,arrivalVersionId:slot?.arrival_version_id??null},
   original:original?metadata(id,text(attempt.dispatch_id),text(original.detected_type),integer(original.byte_size,26214400),text(original.sha256)):null,preview:original?metadata(id,text(attempt.dispatch_id),'image/jpeg',integer(original.preview_byte_size,8388608),text(original.preview_sha256),true):null});
 }
 const bills=unique(rows('crest.supplier_bill_draft_revisions'),row=>text(row.bill_id)+':'+text(row.revision)),originals=unique(rows('crest.supplier_bill_originals'),row=>text(row.id)),intents=unique(rows('crest.supplier_bill_original_intents'),row=>text(row.id));
 for(const id of originals.keys())require(intents.has(id));
 for(const[id,intent]of intents){
  const original=originals.get(id),draft=bills.get(text(intent.bill_id)+':'+text(intent.bill_revision));require(draft);const draftBody=json(draft.payload);require(draftBody&&typeof draftBody==='object'&&'documentReference'in draftBody&&draftBody.documentReference===intent.document_reference);
  const reservation=parseReceiptReservation({businessId:capture.businessId,receiptId:id,expenseId:intent.bill_id,expenseRevision:intent.bill_revision,recoveryEpoch:intent.recovery_epoch,declaredType:intent.media_type,byteSize:integer(intent.byte_size,26214400),dispatchId:intent.dispatch_id,stagingKey:`staging/${capture.businessId}/${id}/${intent.dispatch_id}`,originalKey:`originals/${capture.businessId}/${id}`,previewKey:`previews/${capture.businessId}/${id}`});
  const candidate=original?parseReceiptCandidate(json(original.candidate),reservation):null;
  if(original)require(original.bill_id===intent.bill_id&&original.bill_revision===intent.bill_revision&&original.document_reference===intent.document_reference&&original.object_key===candidate!.original.key&&original.file_sha256===candidate!.original.sha256&&original.byte_size===String(candidate!.original.byteSize)&&original.media_type===candidate!.source.detectedType);
  add({...defaults,attachmentId:id,kind:'supplier_document',status:candidate?'available':'reserved',sourceTable:'crest.supplier_bill_original_intents',mediaType:reservation.declaredType,byteSize:reservation.byteSize,recordedAt:original?text(original.verified_at):text(intent.reserved_at),references:{billId:text(intent.bill_id),billRevision:text(intent.bill_revision),documentReference:intent.document_reference??null},
   original:candidate?metadata(id,id,candidate.source.detectedType,candidate.original.byteSize,candidate.original.sha256):null,preview:candidate?metadata(id,id,'image/jpeg',candidate.preview.byteSize,candidate.preview.sha256,true):null});
 }
 if(capture.profile==='crest.current-business-rows.v4'){
  const openingIntents=unique(rows('crest.opening_document_intents'),row=>text(row.id)),openingOriginals=unique(rows('crest.opening_document_originals'),row=>text(row.id));
  for(const id of openingOriginals.keys())require(openingIntents.has(id));
  for(const[id,intent]of openingIntents){
   const original=openingOriginals.get(id),record=parseOpeningDocumentRecord({state:'ready',schemaVersion:1,reservation:{businessId:capture.businessId,documentId:id,reference:intent.reference,sha256:intent.expected_sha256,recoveryEpoch:intent.recovery_epoch,declaredType:intent.media_type,byteSize:integer(intent.byte_size,26214400),dispatchId:intent.dispatch_id,stagingKey:`staging/${capture.businessId}/${id}/${intent.dispatch_id}`,originalKey:`originals/${capture.businessId}/${id}`,previewKey:`previews/${capture.businessId}/${id}`},candidate:original?json(original.candidate):null},capture.businessId,id),r=record.reservation,c=record.candidate;
   require(!original||c!==null);
   // Same physical document domain, truthful source table, no fabricated bill.
   add({...defaults,attachmentId:id,kind:'supplier_document',status:c?'available':'reserved',sourceTable:'crest.opening_document_intents',mediaType:r.declaredType,byteSize:r.byteSize,recordedAt:original?text(original.recorded_at):text(intent.recorded_at),references:{billId:null,billRevision:null,documentReference:record.evidence.reference},original:c?metadata(id,id,c.source.detectedType,c.original.byteSize,c.original.sha256):null,preview:c?metadata(id,id,'image/jpeg',c.preview.byteSize,c.preview.sha256,true):null});
  }
 }
 result.sort((a,b)=>a.attachmentId<b.attachmentId?-1:a.attachmentId>b.attachmentId?1:0);
 return Object.freeze({schemaVersion:1 as const,profile:'crest.current-attachment-inventory.v1' as const,businessId:capture.businessId,snapshotToken:capture.snapshotToken,observedAt:capture.observedAt,attachments:Object.freeze(result),availableCount:result.filter(item=>item.status==='available').length,pendingCount:result.filter(item=>item.status==='reserved').length,originalBytesIncluded:false as const,originalFilenamesRetained:false as const,completePortableExport:false as const,completeBackup:false as const});
}
export function formatCurrentAttachmentInventory(capture:CurrentBusinessRows){
 const inventory=currentAttachmentInventory(capture),manifest=JSON.stringify(inventory)+'\n';require(Buffer.byteLength(manifest)<=33554432);
 return Object.freeze({inventory,files:Object.freeze({'attachment_inventory.json':Buffer.from(manifest),'attachment_inventory_readme.txt':Buffer.from('Private original-file inventory\n\nThe listed original and preview paths are portable destinations, not storage URLs or download authority. No original file bytes are included by this inventory. Available means retained validated metadata, not a verified download. Reserved entries have no confirmed original; do not treat them as recovered. Original upload filenames were not retained by these source schemas; no filename is invented. Keep the complete source tables for all expense revisions, supplier drafts and custody links, including voided/corrected and unlinked retained records. Recover each listed original with its exact byte count and SHA-256 before claiming file completeness.\n')})});
}
