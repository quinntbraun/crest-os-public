import {describe,it,expect} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {formatServiceCatalogCsv,ServiceCatalogCsvError} from '../../src/commercial/service-catalog-csv.ts';
import {serviceStorageFixture} from '../support/service-storage-fixture.ts';
import {decodeServiceCatalogCsv} from '../support/service-catalog-csv-fixture.ts';
import {readCustomerCsv} from '../support/customer-fixture.ts';
import type {StoredService,StoredServiceContent} from '../../src/commercial/service-storage-contract.ts';

const f=serviceStorageFixture(),snapshotToken='a'.repeat(64);
const input=()=>({businessId:f.business,snapshotToken,expectedServiceCount:'1',expectedVersionCount:'1',services:[{...f.service}],versions:[{...f.content}]});
function history(){const v2={...f.content,id:randomUUID(),sequence:'2',name:'Later synthetic scope',operation_id:randomUUID()},service={...f.service,current_version_id:v2.id,active:false,version:'4',operation_id:randomUUID()};return {...input(),expectedVersionCount:'2',services:[service],versions:[v2,{...f.content}]};}
describe('paired catalog source CSV representation',()=>{
 it('retains every directory/content field, inactive state and earlier version without changing inputs',()=>{
  const source=history(),before=structuredClone(source),files=formatServiceCatalogCsv(source);
  expect(decodeServiceCatalogCsv(files.servicesCsv,files.escapeMap,'services')).toEqual(source.services);
  expect(decodeServiceCatalogCsv(files.versionsCsv,files.escapeMap,'service_versions')).toEqual([...source.versions].sort((a,b)=>a.id<b.id?-1:1));expect(source).toEqual(before);expect(Object.isFrozen(files)).toBe(true);
 });
 it.each(['','\\N','\\\\N',"'original",'=1+2',' \t+SUM(1,2)','\n@function','-original','ordinary, "quoted"\r\n é 😀'])('round trips raw text %j with declared formula and null-marker escaping',exclusions=>{
  const source=input();source.versions[0]={...f.content,exclusions,internal_guidance:null,range_low_cents:null,range_high_cents:null,estimated_seconds:null};const files=formatServiceCatalogCsv(source);
  expect(decodeServiceCatalogCsv(files.versionsCsv,files.escapeMap,'service_versions')).toEqual(source.versions);expect(files.versionsCsv.endsWith('\r\n')).toBe(true);
 });
 it('preserves maximum exact integer strings as source text rather than JS numbers',()=>{
  const source=input();source.services[0]={...f.service,version:'9007199254740993'};source.versions[0]={...f.content,range_low_cents:'9223372036854775807',range_high_cents:'9223372036854775807',estimated_seconds:'9223372036854775807'};const files=formatServiceCatalogCsv(source);
  expect(decodeServiceCatalogCsv(files.servicesCsv,files.escapeMap,'services')).toEqual(source.services);expect(decodeServiceCatalogCsv(files.versionsCsv,files.escapeMap,'service_versions')).toEqual(source.versions);
 });
 it('does not conflate row IDs shared by different tables or infer an apostrophe escape',()=>{
  const source=input();source.services[0]={...f.service,id:f.content.id};source.versions[0]={...f.content,service_id:f.content.id,exclusions:"'\" \\N",internal_guidance:'=private'};const files=formatServiceCatalogCsv(source),map=JSON.parse(files.escapeMap);
  expect(map.escapes.every((e:{entity:string})=>e.entity==='service_versions')).toBe(true);expect(decodeServiceCatalogCsv(files.versionsCsv,files.escapeMap,'service_versions')).toEqual(source.versions);
 });
 it('binds every emitted part by UTF-8 length/hash with explicit privacy and incomplete assurances',()=>{
  const files=formatServiceCatalogCsv(input()),manifest=JSON.parse(files.manifest),parts:Record<string,string>={'services.csv':files.servicesCsv,'service_versions.csv':files.versionsCsv,'service_catalog_escape_map.json':files.escapeMap,'service_catalog_dictionary.json':files.dictionary};
  expect(manifest).toMatchObject({businessId:f.business,snapshotToken,serviceCount:'1',versionCount:'1',snapshotProven:false,sourceCompletenessProven:false,catalogReferenceClosureComplete:true,referenceClosureComplete:false,completeCrestExport:false,completeBackup:false});
  expect(manifest.parts).toHaveLength(4);for(const part of manifest.parts){expect(part.bytes).toBe(Buffer.byteLength(parts[part.name]!));expect(part.sha256).toBe(createHash('sha256').update(parts[part.name]!).digest('hex'));}
  const dictionary=JSON.parse(files.dictionary);expect(dictionary.tables.services.columns).toHaveLength(13);expect(dictionary.tables.service_versions.columns).toHaveLength(16);expect(dictionary.privacy).toContain('never a customer quote');expect(dictionary.decode).toContain('as text');
 });
 it('keeps an empty catalog explicit through two header-only files',()=>{
  const files=formatServiceCatalogCsv({...input(),expectedServiceCount:'0',expectedVersionCount:'0',services:[],versions:[]});expect(readCustomerCsv(files.servicesCsv)).toHaveLength(1);expect(readCustomerCsv(files.versionsCsv)).toHaveLength(1);
 });
 it.each(['bad','a'.repeat(64)+'\n','A'.repeat(64),'../private'])('rejects a noncanonical snapshot token %j',snapshotToken=>{expect(()=>formatServiceCatalogCsv({...input(),snapshotToken})).toThrow(ServiceCatalogCsvError);});
 it.each(['01','1\n','-1','1001',1])('rejects a noncanonical or excessive count %j',expectedServiceCount=>{expect(()=>formatServiceCatalogCsv({...input(),expectedServiceCount} as never)).toThrow(ServiceCatalogCsvError);});
 it('refuses incomplete counts, duplicate roots/codes/content and sparse arrays',()=>{
  const sources=[{...input(),expectedServiceCount:'2'},{...input(),expectedServiceCount:'2',services:[f.service,f.service]},{...input(),expectedServiceCount:'2',services:[f.service,{...f.service,id:randomUUID()}]},{...input(),expectedVersionCount:'2',versions:[f.content,f.content]},{...input(),services:Array(1)},{...input(),versions:Array(1)}];
  for(const source of sources)expect(()=>formatServiceCatalogCsv(source)).toThrow(ServiceCatalogCsvError);
 });
 it('refuses foreign rows, unexpected columns and private future fields',()=>{
  for(const patch of [{business_id:randomUUID()},{extra:'future-source-field'},{current_version_id:randomUUID()}])expect(()=>formatServiceCatalogCsv({...input(),services:[{...f.service,...patch}]})).toThrow(ServiceCatalogCsvError);
  for(const patch of [{business_id:randomUUID()},{service_id:randomUUID()},{extra:'future-source-field'}])expect(()=>formatServiceCatalogCsv({...input(),versions:[{...f.content,...patch}]})).toThrow(ServiceCatalogCsvError);
 });
 it('refuses missing or repointed retained content, sequence gaps and impossible revision counts',()=>{
  const source=history();for(const corrupted of [{...source,expectedVersionCount:'1',versions:[source.versions[0]!]},{...source,services:[{...source.services[0]!,current_version_id:f.content.id}]},{...source,versions:[{...source.versions[0]!,sequence:'3'},source.versions[1]!]},{...source,services:[{...source.services[0]!,version:'1'}]}])expect(()=>formatServiceCatalogCsv(corrupted)).toThrow(ServiceCatalogCsvError);
 });
 it('preserves original creation identity and rejects unchanged appended scope',()=>{
  const source=history();expect(()=>formatServiceCatalogCsv({...source,versions:[{...f.content,id:source.versions[0]!.id,sequence:'2'},f.content]})).toThrow(ServiceCatalogCsvError);
  for(const patch of [{created_by:randomUUID()},{origin:'import' as const},{import_row_id:randomUUID()}])expect(()=>formatServiceCatalogCsv({...input(),services:[{...f.service,...patch}]})).toThrow(ServiceCatalogCsvError);
 });
 it('fails the bounded export instead of silently truncating oversized source text',()=>{
  const services:StoredService[]=[],versions:StoredServiceContent[]=[];for(let i=0;i<1000;i++){const id=randomUUID(),contentId=randomUUID(),operation=randomUUID();services.push({...f.service,id,code:'synthetic-'+i,current_version_id:contentId,operation_id:operation});versions.push({...f.content,id:contentId,service_id:id,operation_id:operation,inclusions:'😀'.repeat(4000),exclusions:'😀'.repeat(4000)});}
  expect(()=>formatServiceCatalogCsv({...input(),expectedServiceCount:'1000',expectedVersionCount:'1000',services,versions})).toThrow(ServiceCatalogCsvError);
 });
});
