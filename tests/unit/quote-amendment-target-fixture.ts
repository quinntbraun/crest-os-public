import {createHash} from 'node:crypto';
import {amendmentTransportFixture} from './quote-amendment-fixture';
export function amendmentTargetFixture(amendment=false,f=amendmentTransportFixture()){
 const accepted=f.f,revision=amendment?{...accepted.row.revision,id:f.draft.revisionId,kind:'amendment' as const,parent_agreement_id:f.draft.expectedParentAgreementId,sequence:'2',state:'Draft' as const,version:'1',content_version:'1',customer_safe_snapshot:f.p.customer,internal_snapshot:f.p.internal,canonical_content:f.p.canonical,content_hash:createHash('sha256').update(f.p.canonical).digest('hex'),total_cents:f.p.customer.totalCents,operation_id:f.draft.operationId}:accepted.row.revision;
 const family={...accepted.row.family,current_revision_id:revision.id,version:amendment?'7':'6'},target={family,revision,parent:{agreementId:accepted.agreement.id,acceptanceId:accepted.acceptance.id,versionNo:'1',customerId:accepted.f.family.customer_id,sourceLeadId:null,revision:accepted.row.revision},control:{version:'3',activeOfferId:null,initialAcceptanceId:accepted.acceptance.id,currentAgreementId:accepted.agreement.id}},request={businessId:accepted.f.business,familyId:null,search:'',afterId:null,pageSize:10},packet={schemaVersion:1,businessId:request.businessId,targets:[target],hasMore:false};
 return {f,target,request,packet};
}
