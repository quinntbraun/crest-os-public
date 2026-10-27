import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {parseServiceSave,parseStoredService,parseStoredServiceContent,parseServiceCommitted,parseServiceDirectoryPage,parseServiceHistoryPage,serviceContentDefinition,ServiceStorageError} from '../../src/commercial/service-storage-contract.ts';
import {serviceStorageFixture} from '../support/service-storage-fixture.ts';
const f=serviceStorageFixture();
it('seals original identities, scope and explicit optional estimates without defaults',()=>{
 const input=structuredClone(f.request),parsed=parseServiceSave(input);Object.assign(input.payload.definition,{name:'Changed'});expect(parsed.payload.definition.name).toBe(f.content.name);expect(Object.isFrozen(parsed.payload.definition)).toBe(true);expect(parsed.payload.definition.rangeHighCents).toBe(null);expect(serviceContentDefinition(parseStoredServiceContent(f.content,f.business,f.service.id))).toEqual(f.request.payload.definition);
});
it.each(['\n','\r','\u2028',' '])('rejects trailing identity and revision terminator %j',tail=>{
 expect(()=>parseServiceSave({...f.request,serviceId:f.service.id+tail})).toThrow();expect(()=>parseServiceSave({...f.request,expectedRevision:'1'+tail})).toThrow();expect(()=>parseStoredService({...f.service,version:'1'+tail},f.business)).toThrow();
});
it.each([{expectedRevision:1},{expectedRevision:'01'},{expectedRevision:'9223372036854775808'},{operationId:'x'},{recoveryEpoch:null},{schemaVersion:2},{unexpected:true},{payload:{...f.request.payload,unexpected:true}},{payload:{...f.request.payload,code:'UPPER'}},{payload:{...f.request.payload,definition:{...f.request.payload.definition,rangeLowCents:0}}}])('rejects malformed save %j',patch=>{expect(()=>parseServiceSave({...f.request,...patch})).toThrow();});
it('preserves bigint cents and root revisions beyond JavaScript numeric precision',()=>{
 const content={...f.content,range_low_cents:'9223372036854775807',range_high_cents:'9223372036854775807',estimated_seconds:'9223372036854775807'};
 expect(parseStoredServiceContent(content,f.business,f.service.id)).toEqual(content);expect(parseStoredService({...f.service,version:'9007199254740993'},f.business).version).toBe('9007199254740993');
});
it.each([{business_id:randomUUID()},{active:'true'},{current_version_id:'x'},{version:1},{version:'0'},{updated_at:'2026-10-26T12:34:56.123456Z'},{created_at:'2026-10-27T12:34:56.123Z'},{updated_at:'2026-10-27T12:34:56.123456Z\n'},{extra:true}])('rejects malformed source projection %j',patch=>{expect(()=>parseStoredService({...f.service,...patch},f.business)).toThrow(ServiceStorageError);});
it.each([{business_id:randomUUID()},{service_id:randomUUID()},{sequence:'0'},{range_low_cents:'-1'},{range_low_cents:null,range_high_cents:'100'},{estimated_seconds:'0'},{name:''},{internal_guidance:' '},{extra:true}])('rejects malformed retained content %j',patch=>{expect(()=>parseStoredServiceContent({...f.content,...patch},f.business,f.service.id)).toThrow();});
it('retains original receipt identities and epoch independently of a later current record',()=>{expect(parseServiceCommitted(f.committed,f.business,f.operation)).toEqual(f.committed);expect(Object.isFrozen(parseServiceCommitted(f.committed,f.business,f.operation).receipt)).toBe(true);});
it.each([{serviceRevision:1},{serviceRevision:'0'},{contentSequence:'2'},{contentSequence:'01'},{contentAuditEventId:null},{contentAuditEventId:f.receipt.auditEventId},{businessId:randomUUID()},{contentVersionId:'x'},{extra:true}])('rejects malformed original receipt %j',patch=>{expect(()=>parseServiceCommitted({...f.committed,receipt:{...f.receipt,...patch}},f.business,f.operation)).toThrow();});
it('archive/reopen receipts can refer to older content without a new content audit',()=>{const receipt={...f.receipt,serviceRevision:'4',contentSequence:'2',contentAuditEventId:null};expect(parseServiceCommitted({...f.committed,receipt},f.business,f.operation).receipt).toEqual(receipt);});
it('validates directory current pointer, parent, active filter, order and complete page marker',()=>{
 expect(parseServiceDirectoryPage(f.directory,f.listRequest).services[0]).toEqual({service:f.service,content:f.content});
 for(const value of [{...f.directory,hasMore:true},{...f.directory,businessId:randomUUID()},{...f.directory,services:[f.directory.services[0],f.directory.services[0]]},{...f.directory,services:[{service:{...f.service,current_version_id:randomUUID()},content:f.content}]},{...f.directory,services:[{service:{...f.service,active:false},content:f.content}]}])expect(()=>parseServiceDirectoryPage(value,f.listRequest)).toThrow();
 expect(()=>parseServiceDirectoryPage(f.directory,{...f.listRequest,afterId:f.service.id})).toThrow();
});
it('validates complete original history and rejects omitted final events',()=>{
 expect(parseServiceHistoryPage(f.history,f.historyRequest)).toEqual(f.history);
 for(const value of [{...f.history,history:[]},{...f.history,hasMore:true},{...f.history,history:[{...f.event,actorId:randomUUID()}]},{...f.history,history:[{...f.event,operationId:randomUUID()}]},{...f.history,history:[{...f.event,action:'archive'}]},{...f.history,service:{...f.service,active:false}}])expect(()=>parseServiceHistoryPage(value,f.historyRequest)).toThrow();
});
function chain(){
 const op2=randomUUID(),op3=randomUUID(),v2={...f.content,id:randomUUID(),sequence:'2',name:'New scope',operation_id:op2},s2={...f.service,current_version_id:v2.id,version:'2',operation_id:op2},s3={...s2,active:false,version:'3',operation_id:op3};
 const e2={...f.event,revision:'2',eventId:randomUUID(),operationId:op2,action:'edit',before:f.service,after:s2,content:v2},e3={...f.event,revision:'3',eventId:randomUUID(),operationId:op3,action:'archive',before:s2,after:s3,content:v2};
 return{...f.history,service:s3,history:[f.event,e2,e3]};
}
it('preserves changed scope and archive content across contiguous pages',()=>{
 const page=chain();expect(parseServiceHistoryPage(page,f.historyRequest)).toEqual(page);
 expect(parseServiceHistoryPage({...page,history:page.history.slice(0,2),hasMore:true},{...f.historyRequest,pageSize:2})).toMatchObject({hasMore:true});
 expect(parseServiceHistoryPage({...page,history:page.history.slice(2)},{...f.historyRequest,afterRevision:'2'})).toMatchObject({hasMore:false});
 expect(parseServiceHistoryPage({...page,history:[]},{...f.historyRequest,afterRevision:'5'})).toMatchObject({history:[]});
});
it.each(['broken before','wrong action','changed archive scope','jumped content','changed code','changed content actor'])('rejects corrupt history: %s',kind=>{
 const page=structuredClone(chain());
 if(kind==='broken before')page.history[2]!.before={...page.history[2]!.before!,active:false};
 if(kind==='wrong action')page.history[2]!.action='reopen';
 if(kind==='changed archive scope')page.history[2]!.content={...page.history[2]!.content,name:'Tampered'};
 if(kind==='jumped content')Object.assign(page.history[1]!.content,{sequence:'3'});
 if(kind==='changed code')Object.assign(page.history[1]!.after,{code:'other'});
 if(kind==='changed content actor')Object.assign(page.history[1]!.content,{created_by:randomUUID()});
 expect(()=>parseServiceHistoryPage(page,f.historyRequest)).toThrow();
});
