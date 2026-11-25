import type {Proof} from './authentication';
import {readPrivateOriginalFile} from './private-original-file';
import {customerUuid as uuid,customerInstant as instant} from '../customer/customer-contract';
import {downloadObject,parseSourceExportDownloadHeader} from '../security/source-export-download-contract';
import {exportOriginalKinds,parseExportOriginalFile,exportOriginalFilePath} from '../security/source-export-original-contract';
import type {ExportOriginalKind} from '../security/source-export-original-contract';
import type {SourceExportDownloadInventory} from './source-export-download-inventory';

export type OriginalExportFile=ReturnType<typeof parseExportOriginalFile>;
export type OriginalExportInventory=Readonly<{header:SourceExportDownloadInventory['header'];inventorySha256:string;files:readonly OriginalExportFile[];pendingCount:number}>;
function require(value:unknown):asserts value{if(!value)throw Error('SOURCE_EXPORT_ORIGINAL_REVIEW_REQUIRED');}
export async function originalExportHash(bytes:Uint8Array){const owned=new Uint8Array(bytes);try{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',owned)),b=>b.toString(16).padStart(2,'0')).join('');}finally{owned.fill(0);}}
// Input must come through the verified current logical-file reader. These
// consistency checks grant neither server authority nor proof of saved files.
export async function parseOriginalExportInventory(bytes:Uint8Array<ArrayBuffer>,header:SourceExportDownloadInventory['header'],expectedSha256:string,signal:AbortSignal):Promise<OriginalExportInventory>{
 signal.throwIfAborted();require(bytes.byteLength>=1&&bytes.byteLength<=33554432&&/^[a-f0-9]{64}$/.test(expectedSha256));
 const h=parseSourceExportDownloadHeader(header,header.businessId,header.exportJobId,header.generationId);require(h.profile==='crest.current-business-source-bundle.v1'&&(h.sourceSchemaVersion===136||h.sourceSchemaVersion===137||h.sourceSchemaVersion===138||h.sourceSchemaVersion===140||(h.sourceSchemaVersion===141||h.sourceSchemaVersion===142)));
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),raw:unknown=JSON.parse(text);require(JSON.stringify(raw)+'\n'===text&&await originalExportHash(bytes)===expectedSha256);signal.throwIfAborted();
 const v=downloadObject(raw,['schemaVersion','profile','businessId','snapshotToken','observedAt','attachments','availableCount','pendingCount','originalBytesIncluded','originalFilenamesRetained','completePortableExport','completeBackup']);
 require(v.schemaVersion===1&&v.profile==='crest.current-attachment-inventory.v1'&&v.businessId===h.businessId&&typeof v.snapshotToken==='string'&&/^[a-f0-9]{64}$/.test(v.snapshotToken)&&instant(v.observedAt)&&v.originalBytesIncluded===false&&v.originalFilenamesRetained===false&&v.completePortableExport===false&&v.completeBackup===false&&Array.isArray(v.attachments)&&v.attachments.length<=100000);
 const files:OriginalExportFile[]=[];let previous='',pending=0;
 const sourceTables={expense_receipt:'crest.expense_receipt_revisions',supplier_document:'crest.supplier_bill_original_intents',condition_photo:'crest.custody_photo_attempts'};
 for(const item of v.attachments){
  const a=downloadObject(item,['attachmentId','kind','status','sourceTable','mediaType','byteSize','recordedAt','references','original','preview','originalFilename','originalFilenameStatus','delivery']);
  const opening=h.sourceSchemaVersion===142&&a.kind==='supplier_document'&&a.sourceTable==='crest.opening_document_intents';
  require(uuid(a.attachmentId)&&a.attachmentId>previous&&exportOriginalKinds.includes(a.kind as ExportOriginalKind)&&(opening||a.sourceTable===sourceTables[a.kind as ExportOriginalKind])&&['image/jpeg','image/png','image/heic','application/pdf'].includes(a.mediaType as string)&&Number.isSafeInteger(a.byteSize)&&(a.byteSize as number)>=1&&(a.byteSize as number)<=26214400&&instant(a.recordedAt)&&a.originalFilename===null&&a.originalFilenameStatus==='not_retained_by_source'&&a.delivery==='not_delivered');previous=a.attachmentId;
  const referenceKeys=a.kind==='expense_receipt'?['expenseId','expenseRevision','receiptRevision']:a.kind==='supplier_document'?['billId','billRevision','documentReference']:['jobId','jobVehicleId','vehicleId','caseId','pickupCollectionId','returnCollectionId','arrivalVersionId'];
  const references=downloadObject(a.references,referenceKeys);require(Object.values(references).every(value=>value===null||typeof value==='string'&&!value.includes('\0')));
  if(opening)require(references.billId===null&&references.billRevision===null&&typeof references.documentReference==='string'&&references.documentReference.length>=1);
  if(a.status==='reserved'){require(a.original===null&&a.preview===null);pending++;continue;}
  require(a.status==='available');const original=downloadObject(a.original,['objectId','path','mediaType','byteSize','sha256']),preview=downloadObject(a.preview,['objectId','path','mediaType','byteSize','sha256']);
  const file=parseExportOriginalFile({kind:a.kind,attachmentId:a.attachmentId,...original,recordedAt:a.recordedAt},{kind:a.kind as ExportOriginalKind,attachmentId:a.attachmentId});
  require(preview.objectId===file.objectId&&preview.path===`previews/${a.attachmentId}/${file.objectId}.jpg`&&preview.mediaType==='image/jpeg'&&Number.isSafeInteger(preview.byteSize)&&(preview.byteSize as number)>=1&&(preview.byteSize as number)<=8388608&&typeof preview.sha256==='string'&&/^[a-f0-9]{64}$/.test(preview.sha256));files.push(file);
 }
 require(files.length===v.availableCount&&pending===v.pendingCount);signal.throwIfAborted();
 return Object.freeze({header:h,inventorySha256:expectedSha256,files:Object.freeze(files),pendingCount:pending});
}
// The caller owns the returned mutable buffer and must wipe it after use.
export async function downloadExportOriginal(inventory:OriginalExportInventory,file:OriginalExportFile,proof:Proof,external:AbortSignal){
 const h=inventory.header;require(inventory.files.includes(file)&&(h.sourceSchemaVersion===136||h.sourceSchemaVersion===137||h.sourceSchemaVersion===138||h.sourceSchemaVersion===140||(h.sourceSchemaVersion===141||h.sourceSchemaVersion===142))&&/^[A-Za-z0-9_-]{43}$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now()&&Date.parse(h.expiresAt)>Date.now());
 const signal=AbortSignal.any([external,AbortSignal.timeout(Math.max(1,Math.min(95000,proof.expiresAt-Date.now(),Date.parse(h.expiresAt)-Date.now())))]);signal.throwIfAborted();
 const response=await fetch(exportOriginalFilePath,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify({exportJobId:h.exportJobId,generationId:h.generationId,kind:file.kind,attachmentId:file.attachmentId}),signal});
 let owned:Awaited<ReturnType<typeof readPrivateOriginalFile>>|undefined;
 try{
  require(!response.redirected&&[null,'identity'].includes(response.headers.get('content-encoding')));owned=await readPrivateOriginalFile(response,signal,{byteSize:file.byteSize,sha256:file.sha256,mediaType:file.mediaType});
  require(owned.fileName===`receipt-${file.attachmentId}.${file.path.split('.').at(-1)}`&&!signal.aborted&&proof.expiresAt>Date.now()&&Date.parse(h.expiresAt)>Date.now());return owned.bytes;
 }catch{owned?.bytes.fill(0);throw Error('SOURCE_EXPORT_ORIGINAL_UNCONFIRMED');}finally{void response.body?.cancel().catch(()=>{});}
}
