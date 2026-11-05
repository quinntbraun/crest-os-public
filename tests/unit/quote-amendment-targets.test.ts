import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseQuoteAmendmentTargetsRequest,parseQuoteAmendmentTargets} from '../../src/commercial/quote-amendment-targets';
import {amendmentTargetFixture} from './quote-amendment-target-fixture';
it.each([false,true])('observes an accepted family with amendment=%s without rebasing its parent or granting a mutation',async amendment=>{
 const f=amendmentTargetFixture(amendment),r=await parseQuoteAmendmentTargets(f.packet,f.request);expect(r.targets).toHaveLength(1);expect(r.targets[0]!.revision.kind).toBe(amendment?'amendment':'initial');expect(r.targets[0]!.parent.agreementId).toBe(f.f.draft.expectedParentAgreementId);expect(Object.isFrozen(r.targets)).toBe(true);expect(Object.isFrozen(r.targets[0]!.parent)).toBe(true);expect(r).not.toHaveProperty('canCreate');
});
it('reloads only the requested family and preserves explicit empty selection',async()=>{
 const f=amendmentTargetFixture(),request={...f.request,familyId:f.target.family.id,pageSize:1};expect((await parseQuoteAmendmentTargets(f.packet,request)).targets[0]!.family.id).toBe(request.familyId);expect(await parseQuoteAmendmentTargets({...f.packet,targets:[]},request)).toEqual({...f.packet,targets:[]});
});
it.each(['private','wrong-business','version','missing','page','page-zero','search','cursor','family','combined-filter'])('rejects an invalid selector request: %s',fault=>{
 const f=amendmentTargetFixture(),r:Record<string,unknown>={...f.request};if(fault==='private')r.draft='PRIVATE';if(fault==='wrong-business')r.businessId='invalid';if(fault==='version')r.schemaVersion=1;if(fault==='missing')delete r.search;if(fault==='page')r.pageSize=26;if(fault==='page-zero')r.pageSize=0;if(fault==='search')r.search='😀'.repeat(201);if(fault==='cursor')r.afterId='bad';if(fault==='family')r.familyId='bad';if(fault==='combined-filter'){r.familyId=f.target.family.id;r.pageSize=1;r.search='mixed';}expect(()=>parseQuoteAmendmentTargetsRequest(r)).toThrow();
});
it.each(['business','parent','parent-version','parent-acceptance','parent-state','parent-hash','current-hash','family-pointer','recipient','lead-source','hidden-kind','extra','duplicate','oversized-page','wrong-detail','detail-more','short-more'])('refuses a mixed or malformed saved target: %s',async fault=>{
 const f=amendmentTargetFixture(true),packet=structuredClone(f.packet),request={...f.request};
 if(fault==='business')packet.businessId=randomUUID();if(fault==='parent')packet.targets[0]!.control.currentAgreementId=randomUUID();if(fault==='parent-version')packet.targets[0]!.parent.versionNo='2';if(fault==='parent-acceptance')packet.targets[0]!.parent.acceptanceId=randomUUID();
 if(fault==='parent-state')packet.targets[0]!.parent.revision.state='Draft';if(fault==='parent-hash')packet.targets[0]!.parent.revision.content_hash='b'.repeat(64);if(fault==='current-hash')packet.targets[0]!.revision.content_hash='c'.repeat(64);if(fault==='family-pointer')packet.targets[0]!.family.current_revision_id=randomUUID();
 if(fault==='recipient')packet.targets[0]!.parent.customerId=randomUUID();if(fault==='lead-source')Object.assign(packet.targets[0]!.parent,{sourceLeadId:randomUUID()});if(fault==='hidden-kind')Object.assign(packet.targets[0]!.revision,{kind:'initial'});if(fault==='extra')Object.assign(packet.targets[0]!,{draft:'PRIVATE'});
 if(fault==='duplicate')packet.targets.push(packet.targets[0]!);if(fault==='oversized-page')request.pageSize=0;if(fault==='wrong-detail')Object.assign(request,{familyId:randomUUID(),pageSize:1});if(fault==='detail-more'){Object.assign(request,{familyId:f.target.family.id,pageSize:1});packet.hasMore=true;}if(fault==='short-more')packet.hasMore=true;
 await expect(parseQuoteAmendmentTargets(packet,request)).rejects.toThrow();
});
it('rejects old-shaped initial content disguised as an accepted current amendment',async()=>{
 const f=amendmentTargetFixture();Object.assign(f.target.revision,{kind:'amendment',parent_agreement_id:f.target.parent.agreementId});await expect(parseQuoteAmendmentTargets(f.packet,f.request)).rejects.toThrow();
});
