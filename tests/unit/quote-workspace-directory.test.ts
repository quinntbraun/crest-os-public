import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseQuoteDirectoryPage,parseQuoteWorkspaceDirectoryPage} from '../../src/commercial/quote-storage-contract';
import {amendmentTargetFixture} from './quote-amendment-target-fixture';
const page=(f:ReturnType<typeof amendmentTargetFixture>)=>({schemaVersion:1,businessId:f.request.businessId,quotes:[{family:f.target.family,revision:f.target.revision}],hasMore:false});
const request=(f:ReturnType<typeof amendmentTargetFixture>)=>({businessId:f.request.businessId,search:'',afterId:null,pageSize:10});
it('keeps the initial-only contract strict while the workspace explicitly identifies an amendment',()=>{
 const initial=amendmentTargetFixture(),amendment=amendmentTargetFixture(true);expect(parseQuoteDirectoryPage(page(initial),request(initial)).quotes[0]!.revision.kind).toBe('initial');expect(()=>parseQuoteDirectoryPage(page(amendment),request(amendment))).toThrow();const result=parseQuoteWorkspaceDirectoryPage(page(amendment),request(amendment));expect(result.quotes[0]!.revision.kind).toBe('amendment');expect(result.quotes[0]!.revision).toHaveProperty('parent_agreement_id',amendment.target.parent.agreementId);
});
it.each(['parent','cursor','customer','lead','kind','private','duplicate'])('refuses a malformed amendment directory: %s',fault=>{
 const f=amendmentTargetFixture(true),r=page(f);if(fault==='parent')Object.assign(r.quotes[0]!.revision,{parent_agreement_id:'bad'});if(fault==='cursor')r.quotes[0]!.family.current_revision_id=randomUUID();if(fault==='customer')r.quotes[0]!.family.customer_id=randomUUID();if(fault==='lead')r.quotes[0]!.family.lead_id=randomUUID();if(fault==='kind')Object.assign(r.quotes[0]!.revision,{kind:'initial'});if(fault==='private')Object.assign(r.quotes[0]!,{draft:'PRIVATE'});if(fault==='duplicate')r.quotes.push(r.quotes[0]!);expect(()=>parseQuoteWorkspaceDirectoryPage(r,request(f))).toThrow();
});
