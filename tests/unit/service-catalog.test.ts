import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {createCatalogService,parseCatalogService,parseServiceDefinition,reviseCatalogService,setCatalogServiceActive,snapshotServiceForQuote,serviceDurationInput} from '../../src/commercial/service-catalog';
import type {ServiceDefinition} from '../../src/commercial/service-catalog';
const definition=(patch:Partial<ServiceDefinition>={}):ServiceDefinition=>({name:'Synthetic interior',inclusions:'Vacuum and applicable leather care.\nOwner-scoped work.',exclusions:'Exterior protection; no odor guarantee.',internalGuidance:'Private planning note',rangeLowCents:'10000',rangeHighCents:'15000',estimatedSeconds:'5430',...patch});
const create=()=>createCatalogService(randomUUID(),'synthetic-interior',true,definition());
it('retains immutable scope versions while keeping a stable service identity/code',()=>{
 const first=create(),before=JSON.stringify(first),second=reviseCatalogService(first,'1',definition({name:'Revised synthetic interior',inclusions:'Different scope',rangeLowCents:'20000',rangeHighCents:null}));
 expect(JSON.stringify(first)).toBe(before);expect(second.id).toBe(first.id);expect(second.code).toBe(first.code);expect(second.revision).toBe('2');expect(second.versions.map(v=>v.sequence)).toEqual(['1','2']);expect(second.versions[0]).toEqual(first.versions[0]);expect(second.versions[1]!.definition.name).toBe('Revised synthetic interior');
 expect(Object.isFrozen(second)).toBe(true);expect(Object.isFrozen(second.versions)).toBe(true);expect(Object.isFrozen(second.versions[0])).toBe(true);expect(Object.isFrozen(second.versions[0]!.definition)).toBe(true);
});
it('copies only customer-facing source into the quote and does not reprice or rewrite earlier copies',()=>{
 const first=create(),snapshot=snapshotServiceForQuote(first,'1'),original=JSON.stringify(snapshot);
 const second=reviseCatalogService(first,'1',definition({name:'Changed name',inclusions:'Changed work',exclusions:'Changed exclusions',internalGuidance:'Changed private note',rangeLowCents:'99900',rangeHighCents:null}));
 const next=snapshotServiceForQuote(second,'2');expect(JSON.stringify(snapshot)).toBe(original);expect(snapshot.name).toBe('Synthetic interior');expect(next.name).toBe('Changed name');expect(next.serviceId).toBe(snapshot.serviceId);expect(next.serviceVersion).toBe('2');
 expect(Object.keys(snapshot).sort()).toEqual(['serviceId','serviceCode','serviceVersion','name','inclusions','exclusions'].sort());expect(JSON.stringify(snapshot)).not.toContain('Private');expect(JSON.stringify(snapshot)).not.toContain('10000');expect(Object.isFrozen(snapshot)).toBe(true);
});
it('archives instead of deleting, blocks new copies, and reopens without losing any version',()=>{
 const first=create(),snapshot=snapshotServiceForQuote(first,'1'),archived=setCatalogServiceActive(first,'1',false);
 expect(archived.revision).toBe('2');expect(archived.versions).toEqual(first.versions);expect(()=>snapshotServiceForQuote(archived,'2')).toThrow('inactive');
 const revised=reviseCatalogService(archived,'2',definition({inclusions:'Updated while archived'}));expect(revised.active).toBe(false);expect(revised.revision).toBe('3');expect(revised.versions.at(-1)!.sequence).toBe('2');
 const reopened=setCatalogServiceActive(revised,'3',true);expect(reopened.revision).toBe('4');expect(reopened.versions.length).toBe(2);expect(snapshotServiceForQuote(reopened,'4').serviceVersion).toBe('2');expect(snapshot.serviceVersion).toBe('1');
});
it('rejects stale editing, activation and copying including a pre-archive version',()=>{
 const first=create(),second=setCatalogServiceActive(first,'1',false);
 expect(()=>reviseCatalogService(second,'1',definition())).toThrow('stale');expect(()=>setCatalogServiceActive(second,'1',true)).toThrow('stale');expect(()=>snapshotServiceForQuote(second,'1')).toThrow('stale');expect(second.active).toBe(false);expect(second.revision).toBe('2');
});
it('does not manufacture revisions for unchanged submissions',()=>{
 const service=create();expect(reviseCatalogService(service,'1',definition())).toEqual(service);expect(setCatalogServiceActive(service,'1',true)).toEqual(service);
});
it('validates and copies caller-owned nested input before retaining a version',()=>{
 const d={...definition()},service=createCatalogService(randomUUID(),'manual',true,d);d.name='Caller mutated name';expect(service.versions[0]!.definition.name).toBe('Synthetic interior');
 const raw={...service,versions:service.versions.map(v=>({...v,definition:{...v.definition}}))},parsed=parseCatalogService(raw);raw.versions[0]!.definition.name='Changed external copy';expect(parsed.versions[0]!.definition.name).toBe('Synthetic interior');
});
it.each([
 {name:''},{name:' '.repeat(3)},{name:'x'.repeat(201)},{name:'Bad\nname'},{inclusions:''},{inclusions:'x'.repeat(4001)},{inclusions:'Bad\u0000scope'},{exclusions:'\ud800'},{internalGuidance:''},{internalGuidance:'x'.repeat(4001)}
])('rejects invalid service text %j',patch=>expect(()=>parseServiceDefinition({...definition(),...patch})).toThrow('definition'));
it.each([
 {rangeLowCents:'-1'},{rangeLowCents:'01'},{rangeLowCents:100},{rangeHighCents:'9999'},{rangeLowCents:null},{rangeHighCents:'9223372036854775808'}
])('rejects malformed/inverted starting guidance %j',patch=>expect(()=>parseServiceDefinition({...definition(),...patch})).toThrow('range'));
it('supports absent or lower-only guidance and bigint amounts without installing live defaults',()=>{
 expect(parseServiceDefinition(definition({rangeLowCents:null,rangeHighCents:null,internalGuidance:null,estimatedSeconds:null})).rangeLowCents).toBeNull();expect(parseServiceDefinition(definition({rangeHighCents:null})).rangeHighCents).toBeNull();
 expect(parseServiceDefinition(definition({rangeLowCents:'9007199254740993',rangeHighCents:'9223372036854775807'})).rangeLowCents).toBe('9007199254740993');
});
it.each(['0','-1','1.5','1e3','01','9223372036854775808'])('rejects invalid duration %s',estimatedSeconds=>expect(()=>parseServiceDefinition(definition({estimatedSeconds}))).toThrow('duration'));
it('preserves exact minute/second entry including sub-minute work and optional omission',()=>{
 expect(serviceDurationInput('90','30')).toBe('5430');expect(serviceDurationInput('','30')).toBe('30');expect(serviceDurationInput(' 1 ',' 0 ')).toBe('60');expect(serviceDurationInput('','')).toBeNull();expect(serviceDurationInput('150119987579016','33')).toBe('9007199254740993');
});
it.each([['0','0'],['1','60'],['1.5',''],['01',''],['-1',''],['','0'],['','1e2'],['999999999999999999','']])('rejects invalid entered duration %s/%s',(minutes,seconds)=>expect(()=>serviceDurationInput(minutes,seconds)).toThrow('duration'));
it('rejects unknown fields, invalid identity, noncontiguous versions and revision drift',()=>{
 const service=create();expect(()=>parseServiceDefinition({...definition(),price:'100'})).toThrow('definition');
 for(const patch of [{id:'wrong'},{code:'UPPER'},{code:'space code'},{active:'true'},{revision:'0'},{versions:[]},{versions:[{sequence:'2',definition:definition()}]},{versions:[{sequence:'1',definition:definition()},{sequence:'2',definition:definition()}]},{unexpected:true}])expect(()=>parseCatalogService({...service,...patch})).toThrow();
});
it('refuses version/revision overflow rather than mutating retained history',()=>{
 const service=parseCatalogService({...create(),revision:'9223372036854775807'});
 expect(()=>reviseCatalogService(service,service.revision,definition({name:'Changed'}))).toThrow('version');expect(()=>setCatalogServiceActive(service,service.revision,false)).toThrow('version');expect(service.versions.length).toBe(1);
});
it('rejects trailing line terminators in storage codes, amounts, durations and revisions',()=>{
 const service=create();
 for(const end of ['\n','\r','\u2028','\u2029']){
  expect(()=>parseCatalogService({...service,id:service.id+end})).toThrow('service');
  expect(()=>parseCatalogService({...service,code:'valid'+end})).toThrow('service');
  expect(()=>parseServiceDefinition(definition({rangeLowCents:'10000'+end}))).toThrow('range');
  expect(()=>parseServiceDefinition(definition({estimatedSeconds:'60'+end}))).toThrow('duration');
  expect(()=>parseCatalogService({...service,revision:'1'+end})).toThrow('version');
 }
});
