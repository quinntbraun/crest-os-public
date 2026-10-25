import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {createPendingAddressStore,pendingAddress,pendingAddressKey,PendingAddressError} from '../../src/client/pending-address-edit';

const record=()=>({schemaVersion:1,businessId:randomUUID(),binding:randomBytes(32).toString('base64url'),reference:{operationId:randomUUID(),customerId:randomUUID(),addressId:randomUUID(),expectedVersion:'9007199254740993',recoveryEpoch:randomUUID()}});
function fixture(){const memory=new Map<string,string>(),storage={getItem:vi.fn((k:string)=>memory.get(k)??null),setItem:vi.fn((k:string,v:string)=>{memory.set(k,v);}),removeItem:vi.fn((k:string)=>{memory.delete(k);})};return {memory,storage,store:createPendingAddressStore(storage)};}
it('copies and freezes only the bounded original reference, preserving exact versions',()=>{const raw=record(),r=pendingAddress(raw);raw.reference.expectedVersion='2';expect(r.reference.expectedVersion).toBe('9007199254740993');expect(Object.isFrozen(r)).toBe(true);expect(Object.isFrozen(r.reference)).toBe(true);});
it('never overwrites an unresolved reference and clears only the exact record',()=>{const {store}=fixture(),a=pendingAddress(record()),b=pendingAddress(record());expect(store.read()).toBeNull();store.write(a);expect(()=>store.write(b)).toThrow(PendingAddressError);expect(()=>store.clear(b)).toThrow(PendingAddressError);expect(store.read()).toEqual(a);store.require(a);store.clear(a);expect(store.read()).toBeNull();});
it.each(['draft','csrfToken','payloadHash','expiresAt'])('rejects extra %s fields instead of persisting customer data or authority',key=>{expect(()=>pendingAddress({...record(),[key]:'synthetic'})).toThrow(PendingAddressError);});
it.each(['1e3','01','-1','9223372036854775808',1])('rejects malformed original version %s',expectedVersion=>{const value=record();expect(()=>pendingAddress({...value,reference:{...value.reference,expectedVersion}})).toThrow(PendingAddressError);});
it.each(['{','null',' '.repeat(1025)])('blocks malformed/oversized storage without clearing it',raw=>{const {store,memory}=fixture();memory.set(pendingAddressKey,raw);expect(()=>store.read()).toThrow(PendingAddressError);expect(memory.get(pendingAddressKey)).toBe(raw);});
it('verifies a write and a removal rather than assuming storage success',()=>{const {store,storage,memory}=fixture(),value=pendingAddress(record());storage.setItem.mockImplementation(()=>{});expect(()=>store.write(value)).toThrow(PendingAddressError);storage.setItem.mockImplementation((k,v)=>{memory.set(k,v);});store.write(value);storage.removeItem.mockImplementation(()=>{});expect(()=>store.clear(value)).toThrow(PendingAddressError);expect(store.read()).toEqual(value);});
it('wraps access/quota errors without including browser or private error details',()=>{const {store,storage}=fixture();storage.getItem.mockImplementation(()=>{throw new Error('private browser details');});expect(()=>store.read()).toThrow('ADDRESS_REFERENCE_STORAGE_FAILED');});

it('requires the original customer and address together, without retaining location text',()=>{
 const value=record();expect(()=>pendingAddress({...value,reference:{...value.reference,addressId:'missing'}})).toThrow(PendingAddressError);
 expect(()=>pendingAddress({...value,reference:{...value.reference,line1:'private location'}})).toThrow(PendingAddressError);
 const {store}=fixture();store.write(pendingAddress(value));expect(store.read()?.reference.customerId).toBe(value.reference.customerId);expect(store.read()?.reference.addressId).toBe(value.reference.addressId);
});
