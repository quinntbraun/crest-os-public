import {customerUuid as uuid,exactCustomerObject as exact} from '../customer/customer-contract.ts';
import {financeAccountReviewReason} from './finance-account-contract.ts';
import {fileTypes} from '../files/validation-contract.ts';
import type {FileType} from '../files/validation-contract.ts';
export type OpeningDocumentReserve=Readonly<{documentId:string;operationId:string;recoveryEpoch:string;reference:string;sha256:string;contentType:FileType;byteSize:number}>;
export type OpeningDocumentEvidence=Pick<OpeningDocumentReserve,'reference'|'sha256'>;
export type OpeningDocumentStatus=OpeningDocumentEvidence&Readonly<{documentId:string;state:'reserved'|'available';contentType:FileType;byteSize:number}>;
export function parseOpeningDocumentStatus(value:unknown):OpeningDocumentStatus{
 if(!exact(value,['documentId','reference','sha256','state','contentType','byteSize'])||!uuid(value.documentId)||(value.state!=='reserved'&&value.state!=='available')||!fileTypes.includes(value.contentType as FileType)||!Number.isSafeInteger(value.byteSize)||Number(value.byteSize)<1||Number(value.byteSize)>26214400)throw Error('OPENING_DOCUMENT_RESPONSE_UNCONFIRMED');
 parseOpeningDocumentEvidence({reference:value.reference,sha256:value.sha256});return Object.freeze({...value}) as OpeningDocumentStatus;
}
export function parseOpeningDocumentEvidence(value:unknown):OpeningDocumentEvidence{
 if(!exact(value,['reference','sha256'])||!financeAccountReviewReason(value.reference)||[...value.reference].length>200||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256))throw Error('OPENING_DOCUMENT_INPUT_REQUIRED');return Object.freeze({...value}) as OpeningDocumentEvidence;
}
export function parseOpeningDocumentReserve(value:unknown):OpeningDocumentReserve{
 if(!exact(value,['documentId','operationId','recoveryEpoch','reference','sha256','contentType','byteSize'])||![value.documentId,value.operationId,value.recoveryEpoch].every(uuid)||!financeAccountReviewReason(value.reference)||[...value.reference].length>200||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||!fileTypes.includes(value.contentType as FileType)||!Number.isSafeInteger(value.byteSize)||Number(value.byteSize)<1||Number(value.byteSize)>26214400)throw Error('OPENING_DOCUMENT_INPUT_REQUIRED');
 return Object.freeze({...value}) as OpeningDocumentReserve;
}
