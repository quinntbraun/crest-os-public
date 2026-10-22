import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {createPendingEditStore,pendingEdit,pendingEditKey} from '../../src/client/pending-business-edit';
const value=()=>({journalSchema:1,businessId:randomUUID(),binding:randomBytes(32).toString('base64url'),command:{schemaVersion:1,operationId:randomUUID(),recoveryEpoch:randomUUID(),expectedVersion:'9007199254740993',legalName:' Exact synthetic \u00e9 '}});
it('round-trips only a bounded frozen metadata intent without credentials and requires exact ownership to clear it',()=>{
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}},store=createPendingEditStore(storage),v=pendingEdit(value());
  expect(store.read()).toBe(null);store.write(v);expect(store.read()).toEqual(v);expect(Object.isFrozen(store.read()?.command)).toBe(true);expect(map.size).toBe(1);expect(map.has(pendingEditKey)).toBe(true);expect(()=>store.write(pendingEdit(value()))).toThrow();expect(()=>store.clear(pendingEdit(value()))).toThrow();expect(store.read()).toEqual(v);store.require(v);store.clear(v);expect(store.read()).toBe(null);
});
it.each([null,{}, {...value(),journalSchema:2},{...value(),csrfToken:'secret'},{...value(),binding:'bad'},{...value(),businessId:'bad'},
  {...value(),command:{...value().command,legalName:'\u0000'}},{...value(),command:{...value().command,expectedVersion:1}}, {...value(),command:{...value().command,expectedVersion:'9223372036854775808'}}])('rejects malformed/secret-bearing/unsupported records without normalization',v=>expect(()=>pendingEdit(v)).toThrow('PENDING_EDIT_STORAGE_FAILED'));
it.each(['{','x'.repeat(8193)])('never clears an unreadable record',raw=>{
  const removeItem=vi.fn(),store=createPendingEditStore({getItem:()=>raw,setItem:vi.fn(),removeItem});expect(()=>store.read()).toThrow();expect(removeItem).not.toHaveBeenCalled();
});
it('detects blocked, silently ignored and uncertain storage writes',()=>{
  for(const getItem of [()=>null,()=>{throw new Error();}]){const store=createPendingEditStore({getItem,setItem:vi.fn(),removeItem:vi.fn()});expect(()=>store.write(pendingEdit(value()))).toThrow();}
});
