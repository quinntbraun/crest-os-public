import {randomUUID,createHash} from 'node:crypto';
import {commercialFixture} from './quote-commercial-fixture';
import {parseQuoteReplacement} from '../../src/commercial/quote-replacement-contract';
import {quoteInputFromSnapshots} from '../../src/commercial/quote-storage-contract';
import {prepareQuoteReviewContent} from '../../src/commercial/quote-review-content';
export function replacementFixture(){
 const f=commercialFixture('Sent'),request=parseQuoteReplacement({schemaVersion:1,businessId:f.f.business,operationId:randomUUID(),recoveryEpoch:f.f.recovery,familyId:f.row.family.id,revisionId:randomUUID(),expectedFamilyVersion:f.row.family.version,content:quoteInputFromSnapshots(f.row.revision.customer_safe_snapshot,f.row.revision.internal_snapshot)}),p=prepareQuoteReviewContent(request.content);
 const committed={state:'committed' as const,operationId:request.operationId,recoveryEpoch:request.recoveryEpoch,receipt:{schemaVersion:2 as const,businessId:request.businessId,familyId:request.familyId,familyVersion:(BigInt(request.expectedFamilyVersion)+1n).toString(),revisionId:request.revisionId,revisionVersion:'1',contentVersion:'1',contentHash:createHash('sha256').update(p.canonical).digest('hex'),familyAuditEventId:randomUUID(),revisionAuditEventId:randomUUID(),itemAuditEventIds:p.customer.lines.map(()=>randomUUID()),assessmentAuditEventIds:[] as string[]}};
 return {...f,request,committed};
}
