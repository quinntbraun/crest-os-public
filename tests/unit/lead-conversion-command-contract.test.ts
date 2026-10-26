import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {conversionRecordFixture,conversionLinkFixture,conversionBusiness as business} from '../support/lead-conversion-record-fixture';
import {leadConversionToWire,parseLeadConversionWire,bindLeadConversionCommitted,bindLeadConversionReference,parseLeadConversionRead,parseLeadConversionLinkPage,parseLeadConversionConflict} from '../../src/customer/lead-conversion-command-contract';
const parent=()=>conversionRecordFixture(),command=()=>parent().request;
const receipt=()=>{const p=parent();return {state:'committed',operationId:p.operation_id,recoveryEpoch:p.request.recoveryEpoch,receipt:{schemaVersion:1,businessId:business,conversionId:p.id,leadId:p.lead_id,leadVersion:p.lead_version,customerId:p.customer_id,auditEventId:randomUUID()}};};
const ref=()=>{const p=parent();return {operationId:p.operation_id,recoveryEpoch:p.request.recoveryEpoch,conversionId:p.id,leadId:p.lead_id,expectedLeadVersion:p.expected_lead_version,customerId:p.customer_id};};
const page=()=>({schemaVersion:1,businessId:business,conversion:parent(),links:[conversionLinkFixture(),conversionLinkFixture('address')],hasMore:false});
const parse=(v:unknown,after:string|null=null,size=50)=>parseLeadConversionLinkPage(v,business,parent().lead_id,parent().id,after,size);
it('roundtrips complete explicit selections without sending a browser-selected business',()=>{
 const wire=leadConversionToWire(command());expect(wire).not.toHaveProperty('businessId');expect(parseLeadConversionWire(wire,business)).toEqual(command());expect(Object.isFrozen(wire)).toBe(true);
});
it.each(['customer','escaped','nested'])('rejects %s duplicate JSON keys instead of accepting the last value',which=>{
 const wire=leadConversionToWire(command());let json=wire.selectionsJson;
 if(which==='nested')json=json.replace('"expectedVersion":"1"','"expectedVersion":"1","expectedVersion":"1"');
 else json=json.replace('"customer":','"'+(which==='escaped'?'\\u0063ustomer':'customer')+'":null,"customer":');
 expect(()=>parseLeadConversionWire({...wire,selectionsJson:json},business)).toThrow();
});
it.each([null,[],{},'null','[]','{"customer":null}'])('rejects malformed nested selections %s',selectionsJson=>expect(()=>parseLeadConversionWire({...leadConversionToWire(command()),selectionsJson},business)).toThrow());
it('rejects injected authority, unsupported commands and oversized envelopes before dispatch',()=>{
 const wire=leadConversionToWire(command());for(const patch of [{businessId:randomUUID()},{schemaVersion:2},{selectionsJson:' '.repeat(131073)},{operationId:'not-an-id'}])expect(()=>parseLeadConversionWire({...wire,...patch},business)).toThrow();
});
it('binds original receipts to every retained reference, including exact bigint versions',()=>{
 expect(bindLeadConversionCommitted(receipt(),command())).toMatchObject({state:'committed'});expect(bindLeadConversionReference(receipt(),business,ref())).toMatchObject({state:'committed'});
 const c={...command(),expectedLeadVersion:'9007199254740993'},r=receipt();r.receipt.leadVersion='9007199254740994';expect(bindLeadConversionCommitted(r,c).receipt.leadVersion).toBe('9007199254740994');
});
it.each(['businessId','conversionId','leadId','customerId','leadVersion','operationId','recoveryEpoch','extra'])('rejects a receipt with mismatched %s',field=>{
 const r=receipt();if(field==='operationId'||field==='recoveryEpoch')r[field]=randomUUID();else if(field==='extra')Object.assign(r,{private:'unexpected'});else Object.assign(r.receipt,{[field]:field==='leadVersion'?'9007199254740994':randomUUID()});
 expect(()=>bindLeadConversionCommitted(r,command())).toThrow();expect(()=>bindLeadConversionReference(r,business,ref())).toThrow();
});
it('retains absent and exact immutable conversion source without treating it as current directory state',()=>{
 expect(parseLeadConversionRead({state:'absent'},business,parent().lead_id)).toEqual({state:'absent'});expect(parseLeadConversionRead({schemaVersion:1,businessId:business,conversion:parent()},business,parent().lead_id)).toMatchObject({conversion:parent()});
 expect(()=>parseLeadConversionRead({schemaVersion:1,businessId:business,conversion:parent()},business,randomUUID())).toThrow();
});
it('checks complete immutable mapping pages, their cursor and exact terminal marker',()=>{
 const p=page();expect(parse(p)).toMatchObject({links:p.links,hasMore:false});
 expect(parse({...p,links:p.links.slice(0,1),hasMore:true},null,1)).toMatchObject({hasMore:true});
 expect(parse({...p,links:p.links.slice(1)},p.links[0]!.id,1)).toMatchObject({links:p.links.slice(1),hasMore:false});
 expect(parse({...p,links:[]},p.links[1]!.id)).toMatchObject({links:[],hasMore:false});
});
it.each(['missing','duplicate','reversed','wrongParent','falseMore','extra','target'])('rejects %s mapping evidence rather than silently dropping it',which=>{
 const p=page();if(which==='missing')p.links.pop();if(which==='duplicate')p.links[1]=p.links[0]!;if(which==='reversed')p.links.reverse();if(which==='wrongParent')p.links[0]={...p.links[0]!,conversion_id:randomUUID()};if(which==='falseMore')p.hasMore=true;if(which==='extra')Object.assign(p,{private:'unexpected'});if(which==='target')p.links[0]={...p.links[0]!,target_version:'2'};
 expect(()=>parse(p)).toThrow();
});
it.each(['operation','lead','source','destination','conversion'])('recognizes only the fixed %s conversion conflict',reason=>expect(parseLeadConversionConflict({state:'conflict',reason})).toEqual({state:'conflict',reason}));
it.each([{state:'conflict',reason:'unknown'},{state:'conflict',reason:'source',currentVersion:'2'},{state:'denied'}])('rejects an ambiguous conflict %s',v=>expect(()=>parseLeadConversionConflict(v)).toThrow());
