import type {Proof} from './authentication';
import {readPrivateOriginalFile} from './private-original-file';
import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract';
import {parseOpeningDocumentReserve,parseOpeningDocumentEvidence,parseOpeningDocumentStatus} from '../bookkeeping/opening-document-contract';
import type {OpeningDocumentReserve,OpeningDocumentEvidence,OpeningDocumentStatus} from '../bookkeeping/opening-document-contract';
const prefix='/api/business/opening-documents/';
function require(value:unknown):asserts value{if(!value)throw Error('OPENING_DOCUMENT_REQUEST_UNCONFIRMED');}
function headers(proof:Proof){require(/^[A-Za-z0-9_-]{43}$/.test(proof.csrfToken)&&Number.isSafeInteger(proof.expiresAt)&&proof.expiresAt>Date.now());return {'x-crest-csrf':proof.csrfToken};}
async function metadata(response:Response,signal:AbortSignal){
 require(response.status===200&&response.headers.get('cache-control')?.includes('private')&&response.headers.get('cache-control')?.includes('no-store')&&response.headers.get('content-type')?.startsWith('application/json'));const reader=response.body?.getReader();require(reader);const parts:Uint8Array[]=[];let size=0;
 try{for(;;){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;require(size<=4096);parts.push(part.value);}signal.throwIfAborted();const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}finally{bytes.fill(0);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function post(action:string,input:unknown,proof:Proof,external:AbortSignal){
 const signal=AbortSignal.any([external,AbortSignal.timeout(95000)]);signal.throwIfAborted();const response=await fetch(prefix+action,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{...headers(proof),'content-type':'application/json'},body:JSON.stringify(input),signal});return metadata(response,signal);
}
function bound(value:unknown,evidence:OpeningDocumentEvidence,documentId?:string){const result=parseOpeningDocumentStatus(value);require(result.reference===evidence.reference&&result.sha256===evidence.sha256&&(!documentId||result.documentId===documentId));return result;}
export const openingDocuments=Object.freeze({
 async find(input:OpeningDocumentEvidence,proof:Proof,signal:AbortSignal){const evidence=parseOpeningDocumentEvidence(input),value=await post('find',evidence,proof,signal);if(exact(value,['state'])&&value.state==='absent')return null;const result=bound(value,evidence);require(result.state==='available');return result;},
 async reserve(input:OpeningDocumentReserve,proof:Proof,signal:AbortSignal){const plan=parseOpeningDocumentReserve(input),result=bound(await post('reserve',plan,proof,signal),plan,plan.documentId);require(result.contentType===plan.contentType&&result.byteSize===plan.byteSize);return result;},
 async status(input:OpeningDocumentReserve,proof:Proof,signal:AbortSignal){const plan=parseOpeningDocumentReserve(input),result=bound(await post('status',{documentId:plan.documentId},proof,signal),plan,plan.documentId);require(result.contentType===plan.contentType&&result.byteSize===plan.byteSize);return result;},
 async upload(input:OpeningDocumentReserve,file:File,proof:Proof,external:AbortSignal){
  const plan=parseOpeningDocumentReserve(input);require(file.size===plan.byteSize&&file.type===plan.contentType);const signal=AbortSignal.any([external,AbortSignal.timeout(95000)]);signal.throwIfAborted();
  const response=await fetch(prefix+'upload',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{...headers(proof),'content-type':plan.contentType,'x-crest-opening-document':plan.documentId},body:file,signal}),value=await metadata(response,signal);require(exact(value,['documentId','state'])&&value.documentId===plan.documentId&&value.state==='uploaded');
 },
 async verify(input:OpeningDocumentReserve,operationId:string,proof:Proof,signal:AbortSignal){const plan=parseOpeningDocumentReserve(input);require(uuid(operationId));const result=bound(await post('verify',{documentId:plan.documentId,operationId},proof,signal),plan,plan.documentId);require(result.state==='available'&&result.contentType===plan.contentType&&result.byteSize===plan.byteSize);return result;},
 async original(input:OpeningDocumentStatus,proof:Proof,external:AbortSignal){
  const record=parseOpeningDocumentStatus(input);require(record.state==='available');const signal=AbortSignal.any([external,AbortSignal.timeout(95000)]);signal.throwIfAborted();const response=await fetch(prefix+'original',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{...headers(proof),'content-type':'application/json'},body:JSON.stringify({documentId:record.documentId}),signal});
  const file=await readPrivateOriginalFile(response,signal,{byteSize:record.byteSize,sha256:record.sha256,mediaType:record.contentType}),extension=({'image/png':'png','image/jpeg':'jpg','image/heic':'heic','application/pdf':'pdf'} as const)[record.contentType];if(file.fileName!==`receipt-${record.documentId}.${extension}`){file.bytes.fill(0);throw Error('OPENING_DOCUMENT_REQUEST_UNCONFIRMED');}return Object.freeze({...file,fileName:file.fileName.replace('receipt-','opening-original-')});
 },
});
