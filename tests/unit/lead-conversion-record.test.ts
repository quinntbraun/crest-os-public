import {expect,it} from 'vitest';
import {leadConversionColumns,conversionLinkColumns,parseLeadConversionRecord,parseConversionLink,parseLeadConversionCollection} from '../../src/customer/lead-conversion-record.ts';
import {conversionRecordFixture as row,conversionLinkFixture as link,conversionBusiness as business} from '../support/lead-conversion-record-fixture.ts';

it('retains all43 typed source columns, immutable metadata and complete original selection',()=>{
 expect(Object.keys(row())).toEqual([...leadConversionColumns]);expect(Object.keys(link())).toEqual([...conversionLinkColumns]);
 expect(parseLeadConversionRecord(row(),business,row().lead_id)).toEqual(row());
 for(const kind of ['vehicle','address'] as const)expect(parseConversionLink(link(kind),business,row())).toEqual(link(kind));
 expect(parseLeadConversionCollection([row()],[link(),link('address')],business)).toEqual({conversions:[row()],links:[link(),link('address')]});
});
it('copies and deeply freezes the retained command while preserving exact bigint versions and microseconds',()=>{
 const input=row({expected_lead_version:'9007199254740993',lead_version:'9007199254740994',request:{...row().request,expectedLeadVersion:'9007199254740993'}});
 const parsed=parseLeadConversionRecord(input,business);expect(parsed).toEqual(input);expect(Object.isFrozen(parsed)).toBe(true);expect(Object.isFrozen(parsed.request.vehicles)).toBe(true);expect(Object.isFrozen(parsed.request.vehicles[0]!.target)).toBe(true);expect(parsed.request).not.toBe(input.request);
 expect(()=>parseLeadConversionRecord({...input,lead_version:'9007199254740995'},business)).toThrow();
});
it('requires exact parent scope, version transition, original IDs, actor and retained instants',()=>{
 const value=row();expect(()=>parseLeadConversionRecord(value,value.id)).toThrow();expect(()=>parseLeadConversionRecord(value,business,value.id)).toThrow();
 for(const patch of [{id:''},{lead_id:null},{version:'2'},{expected_lead_version:'0'},{lead_version:'1'},{customer_version:1},{customer_version:'9223372036854775808'},{converted_at:'2026-10-25T01:02:03.123457Z'},{updated_at:'2026-10-25T01:02:03.123457Z'},{created_at:'2026-10-25T01:02:03.123Z'},{updated_by:value.id},{origin:'import'},{import_row_id:value.id},{lead_audit_id:value.lead_before_audit_id},{lead_child_operation_id:null},{customer_child_operation_id:value.id},{request:{...value.request,operationId:value.id}},{request:{...value.request,expectedLeadVersion:'2'}},{customer_id:value.id},{operation_id:value.id}])expect(()=>parseLeadConversionRecord({...value,...patch},business)).toThrow();
 for(const key of leadConversionColumns){const missing:Record<string,unknown>={...value};delete missing[key];expect(()=>parseLeadConversionRecord(missing,business)).toThrow();}
});
it('requires one typed vehicle/address pair and the original explicit mapping',()=>{
 const value=link();for(const patch of [{id:business},{conversion_id:business},{lead_id:business},{lead_vehicle_id:null},{vehicle_id:null},{lead_address_id:business,address_id:business},{source_version:'2'},{target_version:'2'},{target_child_operation_id:business},{created_by:business,updated_by:business},{operation_id:business},{origin:'system'},{source_audit_id:null},{target_audit_id:''},{updated_at:'2026-10-25T01:02:03.123457Z'}])expect(()=>parseConversionLink({...value,...patch},business,row())).toThrow();
 for(const key of conversionLinkColumns){const missing:Record<string,unknown>={...value};delete missing[key];expect(()=>parseConversionLink(missing,business)).toThrow();}
});
it('requires new-target child references/version1 and existing-target exact original versions',()=>{
 const target={kind:'new' as const,id:row().customer_id,draft:{displayName:'Explicit 😀',phone:null,email:null,contactPreference:null,outreachOptOut:true,notes:'Original \\N\n=1',customerSince:null,archived:false,archiveReason:null}};
 const parent=row({customer_child_operation_id:business,request:{...row().request,customer:target,addresses:[]}});
 expect(parseLeadConversionRecord(parent,business)).toEqual(parent);expect(()=>parseLeadConversionRecord({...parent,customer_child_operation_id:null},business)).toThrow();expect(()=>parseLeadConversionRecord({...parent,customer_version:'2'},business)).toThrow();
 const vehicle={...parent.request.vehicles[0]!,target:{kind:'new' as const,id:link().vehicle_id!,draft:{label:'New raw report',year:-500,make:null,model:null,color:null,vin:' unusual raw VIN ',plate:null,kind:'other' as const,notes:null,archived:false,archiveReason:null}}};
 const p={...parent,request:{...parent.request,vehicles:[vehicle]}};expect(parseConversionLink({...link(),target_child_operation_id:business},business,p)).toMatchObject({target_version:'1'});expect(()=>parseConversionLink(link(),business,p)).toThrow();
});
it('rejects missing, duplicate and stray mappings instead of calling a subset complete',()=>{
 for(const [parents,children] of [[[],[link()]],[[row()],[]],[[row()],[link()]],[[row()],[link(),link()]],[[row(),row()],[link(),link('address')]],[[row()],[link(),link('address'),link('address',{id:business})]]])expect(()=>parseLeadConversionCollection(parents!,children!,business)).toThrow();
 expect(parseLeadConversionCollection([],[],business)).toEqual({conversions:[],links:[]});
 expect(()=>parseLeadConversionCollection(Array.from({length:1001},()=>row()),[],business)).toThrow();
});
it('allows legitimate UUID coincidence across tables and explicit many-to-one existing targets',()=>{
 const parent=row({id:link().id,request:{...row().request,conversionId:link().id,vehicles:[row().request.vehicles[0]!,{...row().request.vehicles[0]!,linkId:business,leadVehicleId:business}],addresses:[]}});
 const result=parseLeadConversionCollection([parent],[link('vehicle',{conversion_id:parent.id}),link('vehicle',{id:business,lead_vehicle_id:business,conversion_id:parent.id})],business);
 expect(result.conversions[0]!.id).toBe(result.links.find(l=>l.id===parent.id)!.id);expect(new Set(result.links.map(l=>l.vehicle_id)).size).toBe(1);
});
it('rejects noncanonical signed-zero source text instead of silently rewriting retained request evidence',()=>{
 const base=row(),draft={line1:null,line2:null,city:null,region:null,postalCode:null,country:null,exactLocationText:null,instructions:null,latitude:'-0.00000',longitude:'0.000',geocodeSource:null,geocodeAccuracy:null,verifiedAt:null,archived:false,archiveReason:null};
 const candidate={...base,request:{...base.request,addresses:[{...base.request.addresses[0]!,target:{kind:'new' as const,id:link('address').address_id!,draft}}]}};
 expect(()=>parseLeadConversionRecord(candidate,business)).toThrow();const canonical={...candidate,request:{...candidate.request,addresses:[{...candidate.request.addresses[0]!,target:{...candidate.request.addresses[0]!.target,draft:{...draft,latitude:'0.00000'}}}]}};
 expect(parseLeadConversionRecord(canonical,business)).toEqual(canonical);
});
