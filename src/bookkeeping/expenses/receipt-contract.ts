import {expenseCheck as check,expenseExact as exact,expenseId,expenseRevision} from './expense-contract.ts';
import {fileTypes,imageValidationVersion,pdfValidationVersion,heicValidationVersion} from '../../files/validation-contract.ts';
import type {FileType} from '../../files/validation-contract.ts';
export type ReceiptReservation=Readonly<{businessId:string;receiptId:string;expenseId:string;expenseRevision:string;recoveryEpoch:string;declaredType:FileType;byteSize:number;stagingKey:string;originalKey:string;previewKey:string;dispatchId:string}>;
export type ReceiptCandidate=Readonly<{status:'PrivateValidatedCandidate';validationVersion:string;source:Readonly<Record<string,string|number>&{sha256:string;byteSize:number;detectedType:FileType}>;original:Readonly<{key:string;byteSize:number;sha256:string}>;preview:Readonly<{key:string;byteSize:number;sha256:string;contentType:'image/jpeg';width:number;height:number;pageNumber?:number}>}>;
export type ReceiptRecord=Readonly<{receiptVersion:'1'|'2';operationId:string;actorId:string;recordedAt:string;reservation:ReceiptReservation;candidate:ReceiptCandidate|null}>;
export type ReceiptView=Readonly<{receiptId:string;expenseId:string;expenseRevision:string;receiptVersion:'1'|'2';status:'reserved'|'available';declaredType:FileType;byteSize:number;sourceSha256:string|null}>;
const integer=(value:unknown,max:number):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=max;
const hash=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function parseReceiptView(value:unknown):ReceiptView{check(exact(value,['receiptId','expenseId','expenseRevision','receiptVersion','status','declaredType','byteSize','sourceSha256'])&&expenseId(value.receiptId)&&expenseId(value.expenseId)&&expenseRevision(value.expenseRevision)&&fileTypes.includes(value.declaredType as FileType)&&integer(value.byteSize,25*1024*1024)&&(value.receiptVersion==='1'&&value.status==='reserved'&&value.sourceSha256===null||value.receiptVersion==='2'&&value.status==='available'&&hash(value.sourceSha256)));return Object.freeze({...value}) as ReceiptView;}
export function parseReceiptReservation(value:unknown):ReceiptReservation{
 check(exact(value,['businessId','receiptId','expenseId','expenseRevision','recoveryEpoch','declaredType','byteSize','stagingKey','originalKey','previewKey','dispatchId'])&&expenseId(value.businessId)&&expenseId(value.receiptId)&&expenseId(value.expenseId)&&expenseRevision(value.expenseRevision)&&expenseId(value.recoveryEpoch)&&expenseId(value.dispatchId)&&fileTypes.includes(value.declaredType as FileType)&&integer(value.byteSize,25*1024*1024));
 check(value.stagingKey===`staging/${value.businessId}/${value.receiptId}/${value.dispatchId}`&&value.originalKey===`originals/${value.businessId}/${value.receiptId}`&&value.previewKey===`previews/${value.businessId}/${value.receiptId}`);
 return Object.freeze({...value}) as ReceiptReservation;
}
export function parseReceiptCandidate(value:unknown,input:ReceiptReservation):ReceiptCandidate{
 const r=parseReceiptReservation(input),pdf=r.declaredType==='application/pdf',heic=r.declaredType==='image/heic';
 check(exact(value,['status','validationVersion','source','original','preview'])&&value.status==='PrivateValidatedCandidate'&&value.validationVersion===(pdf?pdfValidationVersion:heic?heicValidationVersion:imageValidationVersion));
 const s=value.source,o=value.original,p=value.preview;
 check(exact(s,['sha256','byteSize','detectedType',...(pdf?['pageCount']:heic?['width','height','displayWidth','displayHeight','bitDepth']:['width','height'])])&&hash(s.sha256)&&s.byteSize===r.byteSize&&s.detectedType===r.declaredType);
 if(pdf)check(integer(s.pageCount,100));else{check(integer(s.width,60000000)&&integer(s.height,60000000)&&s.width*s.height<=60000000);if(heic)check(integer(s.displayWidth,60000000)&&integer(s.displayHeight,60000000)&&s.displayWidth*s.displayHeight<=60000000&&integer(s.bitDepth,16)&&s.bitDepth>=8);}
 check(exact(o,['key','byteSize','sha256'])&&o.key===r.originalKey&&o.byteSize===r.byteSize&&o.sha256===s.sha256);
 check(exact(p,['sha256','byteSize','contentType','width','height',...(pdf?['pageNumber']:[]),'key'])&&p.key===r.previewKey&&hash(p.sha256)&&integer(p.byteSize,8*1024*1024)&&p.contentType==='image/jpeg'&&integer(p.width,2048)&&integer(p.height,2048)&&(!pdf||p.pageNumber===1));
 return Object.freeze({status:'PrivateValidatedCandidate',validationVersion:value.validationVersion,source:Object.freeze({...s}),original:Object.freeze({...o}),preview:Object.freeze({...p})}) as ReceiptCandidate;
}
export function parseReceiptRecord(value:unknown,businessId:string,receiptId:string):ReceiptRecord{
 check(exact(value,['receiptVersion','operationId','actorId','recordedAt','reservation','candidate'])&&(value.receiptVersion==='1'||value.receiptVersion==='2')&&expenseId(value.operationId)&&expenseId(value.actorId)&&typeof value.recordedAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.recordedAt));
 const reservation=parseReceiptReservation(value.reservation);check(reservation.businessId===businessId&&reservation.receiptId===receiptId);const instant=new Date(value.recordedAt);check(Number.isFinite(instant.getTime())&&instant.toISOString().slice(0,19)===value.recordedAt.slice(0,19));
 check(value.receiptVersion==='1'?value.candidate===null:value.candidate!==null);return Object.freeze({...value,reservation,candidate:value.candidate===null?null:parseReceiptCandidate(value.candidate,reservation)}) as ReceiptRecord;
}
