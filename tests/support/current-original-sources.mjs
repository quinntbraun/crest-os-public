// Protected-command setup shared by the native original-export and genuine
// authenticated product fixtures. Synthetic data only; no bypass publication.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';
import {imageValidationVersion} from '../../src/files/validation-contract.ts';
const call=async(connection,name,args)=>(await connection.query('SELECT crest_commands.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS result',args)).rows[0].result;
export async function prepareCurrentOriginalSources({sandbox,database,admin,web,owner,bytes,preview}){
 const auth=owner.auth(),sha=value=>createHash('sha256').update(value).digest('hex'),expenseId=randomUUID(),receiptId=randomUUID();
  const body={paidOn:'2026-11-22',amountCents:'1299',currency:'USD',category:'supplies',description:'Synthetic original export',vendor:null,paymentMethod:'card',reference:null,notes:null,voided:false,changeReason:null};
  await call(web,'save_expense',[...auth,owner.epoch,randomUUID(),expenseId,'0',body]);
  const reserved=await call(web,'reserve_expense_receipt',[...auth,owner.epoch,randomUUID(),receiptId,expenseId,'1','image/png',bytes.length]),reservation=reserved.receipt.record.reservation;
  const candidate={status:'PrivateValidatedCandidate',validationVersion:imageValidationVersion,source:{sha256:sha(bytes),byteSize:bytes.length,detectedType:'image/png',width:1,height:1},original:{key:reservation.originalKey,byteSize:bytes.length,sha256:sha(bytes)},preview:{key:reservation.previewKey,byteSize:preview.length,sha256:sha(preview),contentType:'image/jpeg',width:1,height:1}};
  await call(web,'publish_expense_receipt',[...auth,owner.epoch,randomUUID(),receiptId,candidate]);
  // Publish the other two retained original kinds through their registered
  // commands, including an unlinked condition photo with a distinct dispatch ID.
  const finance=await sandbox.connect(database),supplierWorker=await sandbox.connect(database),photoWorker=await sandbox.connect(database);
  await finance.query('SET ROLE crest_finance_preview');await supplierWorker.query('SET ROLE crest_supplier_bill_document_worker');await photoWorker.query('SET ROLE crest_custody_photo_dispatch');
  await admin.query("INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin) SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1",[owner.business,owner.actor]);
  const billId=randomUUID(),supplierId=randomUUID(),dates=(await admin.query('SELECT current_date::text AS day,(current_date+1)::text AS due')).rows[0];
  assert.equal((await call(finance,'save_fictional_supplier_bill_draft',[...auth,owner.epoch,randomUUID(),billId,'0',{incurredOn:dates.day,dueOn:dates.due,unknownDueReason:null,vendor:'Synthetic original supplier',unknownVendorReason:null,documentReference:'SYN-ORIGINAL-1',grossCents:'1299',purchaseTaxCents:'0',purpose:'Synthetic original export',missingReceiptReason:'Original pending publication',splits:[{category:'supplies',grossCents:'1299'}],changeReason:null}])).state,'committed');
  const supplierReservation=(await call(finance,'reserve_fictional_supplier_original',[...auth,owner.epoch,randomUUID(),supplierId,billId,'1','image/png',bytes.length])).receipt.reservation;
  const supplierCandidate={...candidate,original:{...candidate.original,key:supplierReservation.originalKey},preview:{...candidate.preview,key:supplierReservation.previewKey}};
  assert.equal((await call(supplierWorker,'publish_fictional_supplier_original',[...auth,owner.epoch,randomUUID(),supplierId,billId,'1',supplierCandidate])).state,'committed');
  const booking=confirmedBookingRequest(owner);booking.payload.fulfillmentMode='dropoff';
  assert.equal((await call(web,'book_job',[...auth,owner.epoch,booking.operationId,1,booking.jobId,booking.expectedModeSequence,booking.payload])).state,'committed');
  const booked=(await admin.query('SELECT j.mode_version_id,v.id FROM crest.jobs j JOIN crest.job_vehicles v ON v.business_id=j.business_id AND v.job_id=j.id WHERE j.business_id=$1 AND j.id=$2 AND v.vehicle_id=$3',[owner.business,booking.jobId,owner.vehicle])).rows[0];
  assert.equal((await call(web,'save_dropoff_policy',[...auth,owner.epoch,randomUUID(),booked.mode_version_id,{acknowledgementText:null,conditionPhotoRequired:true}])).state,'committed');
  const photoId=randomUUID(),attempt=await call(web,'reserve_dropoff_photo',[...auth,owner.epoch,photoId,booked.id,randomUUID(),1,'image/png',bytes.length]);
  await call(photoWorker,'publish_dropoff_photo',[...auth,owner.epoch,photoId,{detected_type:'image/png',byte_size:bytes.length,sha256:sha(bytes),validation_version:imageValidationVersion,width:1,height:1,display_width:null,display_height:null,bit_depth:null,preview_sha256:sha(preview),preview_byte_size:preview.length,preview_width:1,preview_height:1}]);

 return{expenseId,receiptId,reservation,candidate,supplierId,supplierReservation,photoId,attempt};
}
