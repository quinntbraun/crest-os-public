import {describe,expect,it} from 'vitest';
import {legacyApprovalEvidence,legacyApprovalOutcome,parseLegacyApprovalRequest} from '../../src/customer/legacy-contact-approval-contract';

const businessId='10000000-0000-4000-8000-000000000001';
const batchId='10000000-0000-4000-8000-000000000002';
const operationId='10000000-0000-4000-8000-000000000003';
const approvalsId='10000000-0000-4000-8000-000000000004';
const recoveryEpoch='10000000-0000-4000-8000-000000000005';
const actorId='10000000-0000-4000-8000-000000000006';
const evidenceSha256='a'.repeat(64);
const pinned={schemaVersion:1,businessId,batchId,sourceNamespace:'former-crm',rowCount:3,skippedRows:1,evidenceSha256,
 originalSha256:'b'.repeat(64),mappingSha256:'c'.repeat(64),rowsSha256:'d'.repeat(64),decisionsSha256:'e'.repeat(64)};
const receipt={...pinned,approvalId:approvalsId,operationId,approvedBy:actorId};
const ready={...pinned,state:'ready',undecidedRows:0,staleRows:0,conflictingGroups:0,customerCreates:1,customerLinks:1,vehicleCreates:0,vehicleLinks:1,approval:null};
const request={batchId,evidenceSha256,operationId,recoveryEpoch};

describe('contact batch approval contracts',()=>{
 it('treats absent, unfinished and approved evidence as distinct outcomes',()=>{
  expect(legacyApprovalEvidence({state:'absent'},businessId,batchId)).toEqual({state:'absent'});
  expect(legacyApprovalEvidence({...ready,state:'blocked',customerLinks:0,undecidedRows:1},businessId,batchId).state).toBe('blocked');
  expect(legacyApprovalEvidence({...ready,approval:receipt},businessId,batchId)).toEqual({...ready,approval:receipt});
 });
 it('rejects contradictory readiness, impossible totals and an approval tied to different evidence',()=>{
  for(const invalid of [{...ready,staleRows:1},{...ready,vehicleLinks:3},{...ready,approval:{...receipt,rowsSha256:'0'.repeat(64)}},
   {...ready,businessId:actorId},{...ready,approval:{...receipt,sourceNamespace:'other-source'}},{...ready,sourceNamespace:null}]){
   expect(()=>legacyApprovalEvidence(invalid,businessId,batchId)).toThrow();
  }
 });
 it('binds committed approvals to the exact operation and evidence while accepting an existing receipt',()=>{
  expect(parseLegacyApprovalRequest(request)).toEqual(request);
  expect(()=>parseLegacyApprovalRequest({...request,evidenceSha256:evidenceSha256+'\n'})).toThrow();
  expect(legacyApprovalOutcome({state:'committed',receipt},businessId,request).state).toBe('committed');
  expect(legacyApprovalOutcome({state:'already_approved',receipt},businessId,{...request,operationId:actorId}).state).toBe('already_approved');
  expect(()=>legacyApprovalOutcome({state:'committed',receipt},businessId,{...request,operationId:actorId})).toThrow();
  expect(()=>legacyApprovalOutcome({state:'already_approved',receipt},businessId,{...request,evidenceSha256:'0'.repeat(64)})).toThrow();
 });
});
