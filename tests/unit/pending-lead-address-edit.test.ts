import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {createPendingLeadAddressStore,pendingLeadAddress,pendingLeadAddressKey,PendingLeadAddressError} from '../../src/client/pending-lead-address-edit';

const record=()=>({schemaVersion:1,businessId:randomUUID(),binding:randomBytes(32).toString('base64url'),reference:{operationId:randomUUID(),leadId:randomUUID(),leadAddressId:randomUUID(),expectedVersion:'9007199254740993',recoveryEpoch:randomUUID()}});
function fixture(){const memory=new Map<string,string>(),storage={getItem:vi.fn((k:string)=>memory.get(k)??null),setItem:vi.fn((k:string,v:string)=>{memory.set(k,v);}),removeItem:vi.fn((k:string)=>{memory.delete(k);})};return {memory,storage,store:createPendingLeadAddressStore(storage)};}
it('copies and freezes only the bounded original reference, preserving exact versions',()=>{const raw=record(),r=pendingLeadAddress(raw);raw.reference.expectedVersion='2';expect(r.reference.expectedVersion).toBe('9007199254740993');expect(Object.isFrozen(r)).toBe(true);expect(Object.isFrozen(r.reference)).toBe(true);});
it('never overwrites an unresolved reference and clears only the exact record',()=>{const {store}=fixture(),a=pendingLeadAddress(record()),b=pendingLeadAddress(record());expect(store.read()).toBeNull();store.write(a);expect(()=>store.write(b)).toThrow(PendingLeadAddressError);expect(()=>store.clear(b)).toThrow(PendingLeadAddressError);expect(store.read()).toEqual(a);store.require(a);store.clear(a);expect(store.read()).toBeNull();});
it.each(['draft','csrfToken','payloadHash','expiresAt'])('rejects extra %s fields instead of persisting lead data or authority',key=>{expect(()=>pendingLeadAddress({...record(),[key]:'synthetic'})).toThrow(PendingLeadAddressError);});
it.each(['1e3','01','-1','9223372036854775808',1])('rejects malformed original version %s',expectedVersion=>{const value=record();expect(()=>pendingLeadAddress({...value,reference:{...value.reference,expectedVersion}})).toThrow(PendingLeadAddressError);});
it.each(['{','null',' '.repeat(1025)])('blocks malformed/oversized storage without clearing it',raw=>{const {store,memory}=fixture();memory.set(pendingLeadAddressKey,raw);expect(()=>store.read()).toThrow(PendingLeadAddressError);expect(memory.get(pendingLeadAddressKey)).toBe(raw);});
it('verifies a write and a removal rather than assuming storage success',()=>{const {store,storage,memory}=fixture(),value=pendingLeadAddress(record());storage.setItem.mockImplementation(()=>{});expect(()=>store.write(value)).toThrow(PendingLeadAddressError);storage.setItem.mockImplementation((k,v)=>{memory.set(k,v);});store.write(value);storage.removeItem.mockImplementation(()=>{});expect(()=>store.clear(value)).toThrow(PendingLeadAddressError);expect(store.read()).toEqual(value);});
it('wraps access/quota errors without including browser or private error details',()=>{const {store,storage}=fixture();storage.getItem.mockImplementation(()=>{throw new Error('private browser details');});expect(()=>store.read()).toThrow('LEAD_ADDRESS_REFERENCE_STORAGE_FAILED');});

it('uses a separate opaque slot from intake and never persists location values',()=>{
 const {store,memory}=fixture();memory.set('crest.lead.pending-reference.v1','retained intake reference');const value=pendingLeadAddress(record());store.write(value);expect(memory.get('crest.lead.pending-reference.v1')).toBe('retained intake reference');
 expect([...memory.keys()]).toContain(pendingLeadAddressKey);expect(Object.keys(JSON.parse(memory.get(pendingLeadAddressKey)!))).toEqual(['schemaVersion','businessId','binding','reference']);store.clear(value);expect(memory.get('crest.lead.pending-reference.v1')).toBe('retained intake reference');
 for(const extra of [{line1:'private'},{coordinates:'private'},{instructions:'private'}])expect(()=>pendingLeadAddress({...record(),...extra})).toThrow(PendingLeadAddressError);
});

it('write and exact removal preserve every sibling opaque slot',()=>{
 const {store,memory}=fixture(),siblings=['crest.lead.pending-reference.v1','crest.lead-state.pending-reference.v1','crest.lead-vehicle.pending-reference.v1'];for(const key of siblings)memory.set(key,'retained '+key);const value=pendingLeadAddress(record());store.write(value);for(const key of siblings)expect(memory.get(key)).toBe('retained '+key);store.clear(value);for(const key of siblings)expect(memory.get(key)).toBe('retained '+key);expect(memory.size).toBe(3);
});
