import type {Proof} from './authentication';
import {customerUuid as uuid} from '../customer/customer-contract';
import {readPrivateOriginalFile} from './private-original-file';
import type {PrivateOriginalExpectation} from './private-original-file';
export async function downloadSupplierOriginal(originalId:string,proof:Proof,external:AbortSignal,expected?:PrivateOriginalExpectation){
 if(!uuid(originalId)||!/^[A-Za-z0-9_-]{43}$/.test(proof.csrfToken)||!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=Date.now()||external.aborted)throw Error('SUPPLIER_ORIGINAL_FILE_UNCONFIRMED');
 const signal=AbortSignal.any([external,AbortSignal.timeout(95000)]),response=await fetch('/api/business/supplier-original/original',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-crest-csrf':proof.csrfToken},body:JSON.stringify({originalId}),signal});
 const file=await readPrivateOriginalFile(response,signal,expected);
 const extension=({'image/jpeg':'jpg','image/png':'png','image/heic':'heic','application/pdf':'pdf'} as Record<string,string>)[file.mediaType];
 if(file.fileName!==`receipt-${originalId}.${extension}`){file.bytes.fill(0);throw Error('SUPPLIER_ORIGINAL_FILE_UNCONFIRMED');}
 return Object.freeze({...file,fileName:file.fileName.replace('receipt-','supplier-original-')});
}
