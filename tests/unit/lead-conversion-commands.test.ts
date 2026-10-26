import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createLeadConversionCommands,leadConversionChildOperation} from '../../src/customer/lead-conversion-commands';
import {newConversionCustomer,newConversionVehicle,newConversionAddress} from '../../src/customer/lead-conversion-contract';
import {CustomerDataError} from '../../src/customer/customer-contract';
import {customerFixture} from '../support/customer-fixture';
import {leadFixture} from '../support/lead-fixture';
import {leadVehicleFixture} from '../support/lead-vehicle-fixture';
import {leadAddressFixture} from '../support/lead-address-fixture';

function fixture(){
 const lead=leadFixture({notes:'😀'.repeat(4000),estimated_cents:'9223372036854775807',follow_up_at:'2026-11-01T01:02:03.123456Z'}),businessId=lead.business_id,leadId=lead.id;
 const vehicles=[0,1].map(()=>leadVehicleFixture({id:randomUUID(),business_id:businessId,lead_id:leadId})),addresses=[0,1].map(()=>leadAddressFixture({id:randomUUID(),business_id:businessId,lead_id:leadId}));
 const command={schemaVersion:1 as const,businessId,operationId:randomUUID(),recoveryEpoch:randomUUID(),conversionId:randomUUID(),leadId,expectedLeadVersion:lead.version,customer:{kind:'new' as const,id:randomUUID(),draft:newConversionCustomer(lead,businessId,{contactPreference:null,outreachOptOut:true,notes:null,customerSince:null})},vehicles:vehicles.map(v=>newConversionVehicle(v,businessId,leadId,randomUUID(),randomUUID(),'other')),addresses:addresses.map(a=>newConversionAddress(a,businessId,leadId,randomUUID(),randomUUID()))};
 return {lead,vehicles,addresses,command};
}
const none={customer:null,vehicles:[],addresses:[]};
const plan=(f:ReturnType<typeof fixture>)=>createLeadConversionCommands(f.command,f.lead,f.vehicles,f.addresses,none);
it('creates one ordered customer/vehicle/address/lead plan using only existing fixed domain commands',()=>{
 const f=fixture(),result=plan(f).forServer();expect(result.request).toEqual(f.command);expect(result.steps.map(s=>s.command)).toEqual(['save_customer','save_vehicle','save_vehicle','save_address','save_address','save_lead']);expect(result.steps.map(s=>s.role)).toEqual(['customer','vehicle','vehicle','address','address','lead']);
 expect(new Set([result.request.operationId,...result.steps.map(s=>s.input.operationId)]).size).toBe(7);for(const step of result.steps)expect(step.input).toMatchObject({schemaVersion:1,businessId:f.command.businessId,recoveryEpoch:f.command.recoveryEpoch,expectedVersion:step.role==='lead'?f.lead.version:'0'});
});
it('copies complete original lead intake, changing only the explicitly selected customer link',()=>{
 const f=fixture(),step=plan(f).forServer().steps.find(s=>s.role==='lead')!;expect(step.input.draft).toMatchObject({label:f.lead.label,customerId:f.command.customer.id,notes:'😀'.repeat(4000),estimatedCents:'9223372036854775807',followUpAt:'2026-11-01T01:02:03.123456Z'});expect(Object.keys(step.input.draft)).not.toContain('state');expect(Object.keys(step.input.draft)).not.toContain('lostReason');expect(step.input.expectedVersion).toBe(f.lead.version);expect(f.lead.customer_id).toBeNull();
});
it('new customer-owned addresses use the exact explicit customer and source location evidence',()=>{
 const f=fixture(),source=f.addresses[0]!;Object.assign(source,{latitude:'1.000000000000000000001',longitude:'-2.000000000000000000001',verified_at:'2026-10-25T01:02:03.123456Z',instructions:'😀'.repeat(2000)});f.command.addresses[0]=newConversionAddress(source,f.command.businessId,f.lead.id,f.command.addresses[0]!.linkId,f.command.addresses[0]!.target.id);const step=plan(f).forServer().steps.find(s=>s.role==='address')!;expect(step.input).toMatchObject({addressId:f.command.addresses[0]!.target.id,customerId:f.command.customer.id,draft:{latitude:source.latitude,longitude:source.longitude,verifiedAt:source.verified_at,instructions:source.instructions}});
});
it('existing customer-only conversion never creates, overwrites or reactivates a directory record',()=>{
 const f=fixture(),customer=customerFixture({id:randomUUID(),notes:'Existing customer notes'}),command={...f.command,customer:{kind:'existing',id:customer.id,expectedVersion:customer.version},vehicles:[],addresses:[]},result=createLeadConversionCommands(command,f.lead,[],[],{customer,vehicles:[],addresses:[]}).forServer();expect(result.steps.map(s=>s.command)).toEqual(['save_lead']);expect(result.request.customer).toEqual(command.customer);expect(customer.notes).toBe('Existing customer notes');
});
it('the same original command derives the same complete step identities without random retry IDs',()=>{const f=fixture(),one=plan(f).forServer(),two=plan(structuredClone(f)).forServer();expect(two).toEqual(one);expect(one.steps[0]!.input.operationId).not.toBe(one.request.operationId);});
it('reordering explicit selections retains each entity’s original child identity rather than assigning position-based identities',()=>{
 const f=fixture(),one=plan(f).forServer();f.command.vehicles.reverse();f.command.addresses.reverse();const two=plan(f).forServer(),ids=(v:typeof one)=>v.steps.map(s=>s.input.operationId).sort();expect(ids(two)).toEqual(ids(one));expect(two.steps.map(s=>s.input.operationId)).not.toEqual(one.steps.map(s=>s.input.operationId));
});
it.each(['customer','vehicle','address','lead'] as const)('matches independent Python/hashlib golden bytes for %s child identity',role=>{
 const vectors={customer:'9a4707b1-a8f7-8bbe-9de1-85fca8a7dfac',vehicle:'8ce78a8f-200d-8a49-8c5c-77ea91cdaa1a',address:'58be4bb7-5ccc-8612-974f-c8da37952da8',lead:'face5a0f-2ebb-8398-8098-f697898669e4'};expect(leadConversionChildOperation('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333',role,'44444444-4444-4444-8444-444444444444')).toBe(vectors[role]);
});
it.each(['business','operation','conversion','role','entity'])('changing the %s identity separates child operations',which=>{
 const a=randomUUID(),b=randomUUID(),c=randomUUID(),d=randomUUID(),original=leadConversionChildOperation(a,b,c,'customer',d);expect(leadConversionChildOperation(which==='business'?randomUUID():a,which==='operation'?randomUUID():b,which==='conversion'?randomUUID():c,which==='role'?'vehicle':'customer',which==='entity'?randomUUID():d)).not.toBe(original);
});
it('rejects malformed UUIDs and arbitrary command roles before identity derivation',()=>{for(let index=0;index<4;index++){const ids:string[]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];ids[index]='invalid\x1fidentity';expect(()=>leadConversionChildOperation(ids[0]!,ids[1]!,ids[2]!,'customer',ids[3]!)).toThrow(CustomerDataError);}expect(()=>leadConversionChildOperation(randomUUID(),randomUUID(),randomUUID(),'delete' as never,randomUUID())).toThrow(CustomerDataError);});
it('private plans reject JSON serialization and never expose an execute/HTTP/transaction method',()=>{const value=plan(fixture());expect(()=>JSON.stringify(value)).toThrow('LEAD_CONVERSION_COMMANDS_PRIVATE');expect(Object.keys(value)).toEqual(['forServer','toJSON']);});
it('command inputs and original parent choices stay frozen after outside source changes',()=>{
 const f=fixture(),value=plan(f),result=value.forServer();Object.assign(f.lead,{notes:'Changed outside'});Object.assign(f.vehicles[0]!.reported_vehicle,{label:'Changed outside'});f.command.addresses.reverse();expect(result.steps.find(s=>s.role==='lead')!.input.draft.notes).toBe('😀'.repeat(4000));for(const step of result.steps){expect(Object.isFrozen(step)).toBe(true);expect(Object.isFrozen(step.input)).toBe(true);expect(Object.isFrozen(step.input.draft)).toBe(true);}expect(Object.isFrozen(result.steps)&&Object.isFrozen(result)).toBe(true);
});
