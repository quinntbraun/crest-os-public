import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {confirmedBookingRequest} from '../fixtures/confirmed-booking.ts';

export async function command(connection,name,values){
 const args=values.map((_,index)=>'$'+(index+1)).join(',');
 return (await connection.query('SELECT crest_commands.'+name+'('+args+') AS value',values)).rows[0].value;
}
export async function committed(connection,name,values){
 const result=await command(connection,name,values);assert.equal(result.state,'committed');return result.receipt;
}
export async function issue({admin,web,finance,owner,service,today}){
 const mutate=()=>[...owner.auth(),owner.epoch,randomUUID()];
 await admin.query(`INSERT INTO crest_private.finance_controls(business_id,recovery_authority_id,created_by,origin)
  SELECT $1,id,$2,'system' FROM crest_private.business_recovery_authorities WHERE business_id=$1`,[owner.business,owner.actor]);
 await committed(finance,'configure_fictional_invoice_setup',[...mutate(),{kind:'accounting_period',startsOn:today,reason:'Fictional period'}]);
 await committed(finance,'configure_fictional_invoice_setup',[...mutate(),{kind:'invoice_series',label:'TEST-BALANCE',reason:'Fictional numbering'}]);
 for(const identity of [
  {code:'1100',accountType:'asset',normalSide:'debit',controlKind:'ar',reportRole:'ar'},
  {code:'4900',accountType:'contra_revenue',normalSide:'debit',controlKind:null,reportRole:'contra_revenue'},
  {code:'4000',accountType:'revenue',normalSide:'credit',controlKind:null,reportRole:'service_revenue'},
 ]){
  const id=randomUUID();await committed(finance,'save_finance_account',[...mutate(),1,id,'0',{identity,name:'Fictional '+identity.reportRole,active:true,reason:null}]);
  await committed(finance,'approve_fixed_finance_mapping',[...mutate(),identity.reportRole==='contra_revenue'?'discount':identity.reportRole,'0',id,'2026-01-01','Fictional mapping review']);
 }
 const district='Fictional outstanding district';
 await committed(finance,'approve_finance_tax_profile',[...mutate(),district,'service',service,'0','2026-01-01','non_taxable',null,'Fictional evidence','Fictional review']);
 const booking=confirmedBookingRequest(owner),mode=await admin.query('SELECT max(sequence)::text AS sequence FROM crest.fulfillment_mode_versions WHERE business_id=$1',[owner.business]);
 booking.expectedModeSequence=mode.rows[0].sequence??'0';
 await committed(web,'book_job',[...owner.auth(),owner.epoch,booking.operationId,1,booking.jobId,booking.expectedModeSequence,booking.payload]);
 const arrived=await committed(web,'change_field_session',[...mutate(),1,booking.jobId,'1',{action:'direct_arrive',reason:'Fictional arrival'}]);
 const {assignments}=await command(web,'read_job_completion_context',[...owner.auth(),booking.jobId]);
 const scope=assignments.map(row=>({assignedPartId:row.assignedPartId,expectedPlanId:row.planId,expectedPlanSequence:row.planSequence,
  pieces:[{partitionId:row.partitionId,outcome:'completed',scopeDescription:row.scopeDescription,grossInclusiveCents:row.grossInclusiveCents,
   discountInclusiveCents:row.discountInclusiveCents,amountCents:row.amountCents,reason:null}]}));
 await committed(web,'complete_job',[...mutate(),1,booking.jobId,arrived.jobVersion,{scope,reason:'Fictional completed work',walkthrough:{state:'done',reason:null},
  review:{reviewUrl:null,skipReason:null,additionalRequestReason:null,expectedDuplicateRequestIds:[],expectedCustomerVersion:'1',contactReviewReason:null}}]);
 const draft=randomUUID(),{lines}=await command(finance,'read_invoice_preparation',[...owner.auth(),booking.jobId]);
 await committed(finance,'save_invoice_draft',[...mutate(),draft,'0',booking.jobId,null,lines.map(line=>line.outcomeId),null]);
 const jurisdictions=Object.fromEntries(lines.map(line=>[line.outcomeId,district]));
 const {reviewDigest}=await command(finance,'prepare_reviewed_invoice_issue',[...owner.auth(),draft,'1',jurisdictions]);assert.equal(typeof reviewDigest,'string','The actual invoice review must be ready before issuance.');
 return committed(finance,'issue_reviewed_invoice',[...mutate(),draft,'1',jurisdictions,reviewDigest]);
}
