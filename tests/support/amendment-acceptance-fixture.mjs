// Shared real restricted-command fixture; no application authentication shortcut.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {quoteInputFromSnapshots} from '../../src/commercial/quote-storage-contract.ts';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content.ts';
import {parseQuoteAmendmentAccept} from '../../src/commercial/quote-amendment-acceptance-contract.ts';
export function createAmendmentAcceptanceFixture({client,web}){
 const scalar=async(q,args=[])=>(await client.query(q,args)).rows[0].value;
 async function tx(c,run){await c.query('BEGIN');try{const r=await run();await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}}
async function sentAmendment(p){
 const parent=(await client.query('SELECT g.version_no::text,r.content_hash,r.customer_safe_snapshot,r.internal_snapshot FROM crest.agreements g JOIN crest.quote_acceptances a ON a.business_id=g.business_id AND a.id=g.acceptance_id JOIN crest.quote_revisions r ON r.business_id=a.business_id AND r.id=a.revision_id WHERE g.business_id=$1 AND g.id=$2',[p.business,p.agreementId])).rows[0];
 const content=quoteInputFromSnapshots(parent.customer_safe_snapshot,parent.internal_snapshot),revision=randomUUID();
 const value=async(q,args)=>(await tx(web,()=>web.query(q,args))).rows[0].value;
 const created=await value('SELECT crest_commands.create_quote_amendment_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,3,$11,$12,$13,$14,$15,$16,$17) AS value',[...p.auth(),p.epoch,randomUUID(),p.familyId,revision,await scalar('SELECT version::text AS value FROM crest.quote_families WHERE id=$1',[p.familyId]),p.agreementId,parent.version_no,parent.content_hash,prepareQuoteReviewContent({...content,title:'Synthetic completed-work preservation'})]);assert.equal(created.state,'committed');
 const review=r=>[...p.auth(),p.epoch,randomUUID(),p.familyId,revision,r.familyVersion,r.revisionVersion,r.contentVersion,r.contentHash];
 const submitted=await value('SELECT crest_commands.submit_quote_review($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16) AS value',review(created.receipt));assert.equal(submitted.state,'committed');
 const approval=randomUUID(),approved=await value('SELECT crest_commands.approve_quote_revision($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16,$17,false) AS value',[...review(submitted.receipt),approval]);assert.equal(approved.state,'committed');
 const send=randomUUID(),sent=await value('SELECT crest_commands.confirm_quote_amendment_send($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) AS value',[...review(approved.receipt),send,approval,p.agreementId,parent.version_no,parent.content_hash,{channel:'in_person',recipientSnapshot:{displayName:'Synthetic recipient',phone:null,email:null},evidenceNote:null,confirmedActualSharing:true,presentationHash:approved.receipt.presentationHash,replacesRevisionId:null}]);assert.equal(sent.state,'committed');
 const scopePlans=[];
 for(const s of p.sources){
  const root=(await client.query('SELECT e.stable_line_key,v.id AS version_id,item.gross_cents::text AS gross_inclusive_cents,(item.line_discount_cents+item.allocated_discount_cents)::text AS discount_inclusive_cents,v.authorized_cents::text FROM crest.scope_entitlements e JOIN crest.entitlement_versions v ON v.business_id=e.business_id AND v.entitlement_id=e.id AND v.agreement_id=$3 JOIN crest.quote_items item ON item.business_id=v.business_id AND item.id=v.source_quote_item_id WHERE e.business_id=$1 AND e.id=$2',[p.business,s.entitlement_id,p.agreementId])).rows[0];
  const parts=(await client.query('SELECT * FROM crest.current_scope_allocation_parts WHERE business_id=$1 AND source_allocation_id=$2 ORDER BY stable_partition_id',[p.business,s.id])).rows;
  scopePlans.push({stableLineKey:root.stable_line_key,entitlementId:s.entitlement_id,expectedEntitlementVersionId:root.version_id,entitlementVersionId:randomUUID(),sourceAllocationId:s.id,sourcePartitionId:s.stable_partition_id,expectedPlanId:parts[0].plan_id,expectedPlanSequence:parts[0].plan_sequence,authorizationState:'active',grossInclusiveCents:root.gross_inclusive_cents,discountInclusiveCents:root.discount_inclusive_cents,amountCents:root.authorized_cents,parts:parts.map(a=>({partitionId:a.stable_partition_id,jobId:a.job_id,state:a.allocation_state,grossInclusiveCents:a.gross_inclusive_cents,discountInclusiveCents:a.discount_inclusive_cents,amountCents:a.amount_cents,scopeDescription:a.scope_description}))});
 }
 const confirmation=await scalar("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS value");
 return parseQuoteAmendmentAccept({schemaVersion:1,businessId:p.business,operationId:randomUUID(),recoveryEpoch:p.epoch,familyId:p.familyId,revisionId:revision,expectedFamilyVersion:sent.receipt.familyVersion,expectedRevisionVersion:sent.receipt.revisionVersion,expectedContentVersion:sent.receipt.contentVersion,expectedHash:sent.receipt.contentHash,acceptanceId:randomUUID(),agreementId:randomUUID(),expectedParentAgreementId:p.agreementId,expectedParentAgreementVersion:parent.version_no,expectedParentAcceptedHash:parent.content_hash,scopePlans,body:{sendId:send,customerId:p.customer,conversionId:null,channel:'in_person',counterpartySnapshot:{displayName:'Synthetic recipient',phone:null,email:null},confirmationEffectiveAt:confirmation,evidenceNote:'Synthetic customer confirmed exact sent terms',confirmedExactTerms:true}});
}
async function acceptAmendment(p,request){return (await tx(web,()=>web.query('SELECT crest_commands.accept_quote_amendment_confirmation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS value',[...p.auth(),p.epoch,request.operationId,request]))).rows[0].value;}
async function lookupAmendment(p,id){return (await tx(web,()=>web.query('SELECT crest_commands.lookup_quote_amendment_acceptance($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value',[...p.auth(),id]))).rows[0].value;}

 return {sentAmendment,acceptAmendment,lookupAmendment};
}
