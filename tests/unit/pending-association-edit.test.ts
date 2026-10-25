import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {createPendingAssociationStore,pendingAssociation,pendingAssociationKey,PendingAssociationError} from '../../src/client/pending-association-edit';

const record=()=>({schemaVersion:1,businessId:randomUUID(),binding:randomBytes(32).toString('base64url'),reference:{operationId:randomUUID(),vehicleId:randomUUID(),expectedVersion:'0',recoveryEpoch:randomUUID(),action:'open',associationId:randomUUID(),nextAssociationId:null}});
function fixture(){const memory=new Map<string,string>(),storage={getItem:vi.fn((k:string)=>memory.get(k)??null),setItem:vi.fn((k:string,v:string)=>{memory.set(k,v);}),removeItem:vi.fn((k:string)=>{memory.delete(k);})};return {memory,storage,store:createPendingAssociationStore(storage)};}
it('copies and freezes only the bounded original reference, preserving exact lifecycle intent',()=>{const raw=record(),r=pendingAssociation(raw);raw.reference.expectedVersion='2';expect(r.reference.expectedVersion).toBe('0');expect(Object.isFrozen(r)).toBe(true);expect(Object.isFrozen(r.reference)).toBe(true);});
it('never overwrites an unresolved reference and clears only the exact record',()=>{const {store}=fixture(),a=pendingAssociation(record()),b=pendingAssociation(record());expect(store.read()).toBeNull();store.write(a);expect(()=>store.write(b)).toThrow(PendingAssociationError);expect(()=>store.clear(b)).toThrow(PendingAssociationError);expect(store.read()).toEqual(a);store.require(a);store.clear(a);expect(store.read()).toBeNull();});
it.each(['draft','csrfToken','payloadHash','expiresAt'])('rejects extra %s fields instead of persisting customer-link data or authority',key=>{expect(()=>pendingAssociation({...record(),[key]:'synthetic'})).toThrow(PendingAssociationError);});
it.each(['1e3','01','-1','9223372036854775808',1])('rejects malformed original version %s',expectedVersion=>{const value=record();expect(()=>pendingAssociation({...value,reference:{...value.reference,expectedVersion}})).toThrow(PendingAssociationError);});
it.each(['{','null',' '.repeat(1537)])('blocks malformed/oversized storage without clearing it',raw=>{const {store,memory}=fixture();memory.set(pendingAssociationKey,raw);expect(()=>store.read()).toThrow(PendingAssociationError);expect(memory.get(pendingAssociationKey)).toBe(raw);});
it('verifies a write and a removal rather than assuming storage success',()=>{const {store,storage,memory}=fixture(),value=pendingAssociation(record());storage.setItem.mockImplementation(()=>{});expect(()=>store.write(value)).toThrow(PendingAssociationError);storage.setItem.mockImplementation((k,v)=>{memory.set(k,v);});store.write(value);storage.removeItem.mockImplementation(()=>{});expect(()=>store.clear(value)).toThrow(PendingAssociationError);expect(store.read()).toEqual(value);});
it('wraps access/quota errors without including browser or private error details',()=>{const {store,storage}=fixture();storage.getItem.mockImplementation(()=>{throw new Error('private browser details');});expect(()=>store.read()).toThrow('ASSOCIATION_REFERENCE_STORAGE_FAILED');});

it('transfer metadata requires the distinct original next ID and close cannot become an open',()=>{
 const base=record(),next=randomUUID(),valid={...base,reference:{...base.reference,action:'transfer',expectedVersion:'1',nextAssociationId:next}};
 expect(pendingAssociation(valid).reference.nextAssociationId).toBe(next);
 for(const patch of [{nextAssociationId:null},{nextAssociationId:base.reference.associationId},{expectedVersion:'0'},{action:'close'}])expect(()=>pendingAssociation({...valid,reference:{...valid.reference,...patch}})).toThrow(PendingAssociationError);
});
