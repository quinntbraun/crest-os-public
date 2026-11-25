import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createAddressCustomerLookup,initialAddressCustomerLookup} from '../../src/client/address-customer-lookup';
import type {authentication} from '../../src/client/authentication';
import type {customers} from '../../src/client/customers';
import {customerBusiness,customerFixture} from '../support/customer-fixture';

function fixture(){
 const session=vi.fn<typeof authentication.session>().mockResolvedValue({csrfToken:'synthetic-proof',expiresAt:Date.now()+60000});
 const context=vi.fn<typeof customers.context>().mockResolvedValue({context:{schemaVersion:1,businessId:customerBusiness,writeState:'paused',recoveryEpoch:null},binding:'synthetic-binding'});
 const list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[customerFixture()],hasMore:false}),change=vi.fn();
 return {session,context,list,change,controller:createAddressCustomerLookup({session,context,list,change})};
}
it('does not fetch on mount and uses fresh access before a bounded read, retaining only display fields',async()=>{
 const f=fixture();expect(f.session).not.toHaveBeenCalled();expect(f.controller.view()).toEqual(initialAddressCustomerLookup);
 await f.controller.search('literal%_ search',false);
 expect(f.session.mock.invocationCallOrder[0]).toBeLessThan(f.context.mock.invocationCallOrder[0]!);
 expect(f.context.mock.invocationCallOrder[0]).toBeLessThan(f.list.mock.invocationCallOrder[0]!);
 expect(f.list.mock.calls[0]?.slice(0,2)).toEqual([customerBusiness,{search:'literal%_ search',afterId:null,includeArchived:false,pageSize:10}]);
 expect(Object.keys(f.controller.view().items[0]!).sort()).toEqual(['archived','contact','id','name']);
 expect(JSON.stringify(f.controller.view())).not.toMatch(/synthetic-proof|synthetic-binding|recoveryEpoch|notes/);
});
it('distinguishes failed access from a verified empty search and permits explicit search after recovery',async()=>{
 const f=fixture();f.context.mockRejectedValueOnce(Error('denied'));await f.controller.search('',false);
 expect(f.list).not.toHaveBeenCalled();expect(f.controller.view()).toMatchObject({items:[],hasMore:false,busy:false,message:expect.stringContaining('could not be verified')});
 f.list.mockResolvedValueOnce({customers:[],hasMore:false});await f.controller.search('',false);
 expect(f.controller.view().message).toContain('No matching customers');expect(f.session).toHaveBeenCalledTimes(2);
});
it('replaces pages, checks query/filter identity, and refuses a changed business before the next read',async()=>{
 const f=fixture();f.list.mockResolvedValueOnce({customers:[customerFixture()],hasMore:true});await f.controller.search('name',true);
 await f.controller.search('changed',true,true);await f.controller.search('name',false,true);expect(f.list).toHaveBeenCalledTimes(1);
 await f.controller.search('name',true,true);expect(f.list.mock.calls[1]?.[1]).toEqual({search:'name',afterId:customerFixture().id,includeArchived:true,pageSize:10});
 expect(f.controller.view().items).toHaveLength(1);
 f.list.mockResolvedValueOnce({customers:[customerFixture()],hasMore:true});await f.controller.search('name',true);
 f.context.mockResolvedValueOnce({context:{schemaVersion:1,businessId:randomUUID(),writeState:'paused',recoveryEpoch:null},binding:'changed'});
 await f.controller.search('name',true,true);expect(f.list).toHaveBeenCalledTimes(3);expect(f.controller.view()).toMatchObject({items:[],hasMore:false,message:expect.stringContaining('could not be verified')});
});
it('clears results and aborts an in-flight read without accepting its late result',async()=>{
 const f=fixture();let release!:(v:Awaited<ReturnType<typeof customers.list>>)=>void;
 f.list.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));const pending=f.controller.search('private name',true);
 await vi.waitFor(()=>expect(f.list).toHaveBeenCalledTimes(1));const signal=f.list.mock.calls[0]![3];f.controller.suspend();
 expect(signal.aborted).toBe(true);expect(f.controller.view()).toMatchObject({items:[],search:'',includeArchived:false,busy:false});
 release({customers:[customerFixture()],hasMore:true});await pending;expect(f.controller.view().items).toEqual([]);
 await f.controller.search('',false);expect(f.controller.view().items).toHaveLength(1);
 f.controller.dispose();const calls=f.change.mock.calls.length;await f.controller.search('',false);expect(f.change).toHaveBeenCalledTimes(calls);expect(f.controller.view()).toEqual(initialAddressCustomerLookup);
});
it('does not dispatch concurrent reads and respects the existing Unicode codepoint limit',async()=>{
 const f=fixture();await f.controller.search('😀'.repeat(201),false);expect(f.session).not.toHaveBeenCalled();expect(f.controller.view().message).toContain('200 characters');
 let release!:(v:Awaited<ReturnType<typeof authentication.session>>)=>void;f.session.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const pending=f.controller.search('😀'.repeat(200),false);await f.controller.search('other',true);expect(f.session).toHaveBeenCalledTimes(1);
 f.controller.dispose();release({csrfToken:'late-proof',expiresAt:Date.now()+60000});await pending;expect(f.context).not.toHaveBeenCalled();
});
