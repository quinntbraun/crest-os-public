import {randomBytes} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {reviewCustomerContacts,customerContactKeys} from '../../src/client/customer-contact-review';
import {emptyCustomerDraft} from '../../src/client/customer-editor-controller';
import type {customers} from '../../src/client/customers';
import {customerBusiness,customerFixture} from '../support/customer-fixture';

const proof=()=>({csrfToken:randomBytes(32).toString('base64url'),expiresAt:Date.now()+60000});
const signal=()=>new AbortController().signal;
const match=()=>customerFixture({phone_raw:'+1 (555) 555-0123',phone_normalized:'15555550123',email_raw:'Owner@Example.com',email_normalized:'owner@example.com'});
it('keeps raw fields unchanged and matches the existing digit/ASCII-space search conventions',()=>{
 const raw={phone:'+1 (555) 555-0123 ext 8',email:'  Owner@Example.com  '};expect(customerContactKeys(raw)).toEqual({phone:'155555501238',email:'Owner@Example.com'});expect(raw.email).toBe('  Owner@Example.com  ');
 expect(customerContactKeys({phone:'unknown',email:'   '})).toEqual({phone:null,email:null});
});
it('uses real bounded contact searches including archives, deduplicates candidates and exposes no notes or contact payloads',async()=>{
 const list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[match()],hasMore:false}),draft={...emptyCustomerDraft,displayName:'Different household member',phone:'15555550123',email:'Owner@Example.com'},p=proof(),s=signal();
 const result=await reviewCustomerContacts(draft,null,customerBusiness,p,s,list);
 expect(list.mock.calls.map(call=>call[1])).toEqual([{search:'15555550123',afterId:null,includeArchived:true,pageSize:50},{search:'Owner@Example.com',afterId:null,includeArchived:true,pageSize:50}]);
 expect(list.mock.calls.every(call=>call[0]===customerBusiness&&call[2]===p&&call[3]===s)).toBe(true);
 expect(result).toEqual({matches:[{id:match().id,name:match().display_name,archived:false,phone:true,emailSearch:true}],limited:false});
 expect(JSON.stringify(result)).not.toMatch(/phone_raw|csrfToken|Owner@|notes/);expect(Object.isFrozen(result)&&Object.isFrozen(result!.matches[0])).toBe(true);
});
it('excludes only the current identity and retains another archived customer sharing the phone',async()=>{
 const current=match(),other={...match(),id:'55555555-5555-4555-8555-555555555555',archived_at:match().updated_at,archived_reason:'Synthetic archive'};
 const list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[current,other],hasMore:false});
 const result=await reviewCustomerContacts({...emptyCustomerDraft,displayName:'Changed',phone:'15555550123'},current,customerBusiness,proof(),signal(),list);
 expect(result!.matches).toEqual([{id:other.id,name:other.display_name,archived:true,phone:true,emailSearch:false}]);
});
it('does not recheck unchanged existing contacts during unrelated edits or search unknown fields',async()=>{
 const current=match(),list=vi.fn<typeof customers.list>();
 expect(await reviewCustomerContacts({...emptyCustomerDraft,displayName:'Edited notes',phone:current.phone_raw,email:current.email_raw},current,customerBusiness,proof(),signal(),list)).toBeNull();
 expect(await reviewCustomerContacts({...emptyCustomerDraft,displayName:'Unknown contacts',phone:'unknown',email:' '},null,customerBusiness,proof(),signal(),list)).toBeNull();expect(list).not.toHaveBeenCalled();
});
it('does not mistake incidental phone search hits or absent emails for shared contacts',async()=>{
 const list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[customerFixture({display_name:'15555550123 owner@example.com'})],hasMore:false});
 expect(await reviewCustomerContacts({...emptyCustomerDraft,phone:'15555550123',email:'owner@example.com'},null,customerBusiness,proof(),signal(),list)).toBeNull();
});
it('does not replace PostgreSQL email/collation evidence with JavaScript case-fold equality',async()=>{
 const list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[customerFixture({email_raw:'İ@example.com',email_normalized:'i@example.com'})],hasMore:false});
 const result=await reviewCustomerContacts({...emptyCustomerDraft,email:'İ@example.com'},null,customerBusiness,proof(),signal(),list);expect(list.mock.calls[0]![1].search).toBe('İ@example.com');expect(result!.matches[0]!.emailSearch).toBe(true);
});
it('labels partial search coverage even without a matching candidate instead of declaring uniqueness',async()=>{
 const list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[],hasMore:true});
 expect(await reviewCustomerContacts({...emptyCustomerDraft,phone:'123'},null,customerBusiness,proof(),signal(),list)).toEqual({matches:[],limited:true});
});
it('bounds Unicode and long digit search hints without truncating the source draft',async()=>{
 const list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[],hasMore:false}),draft={...emptyCustomerDraft,phone:'1'.repeat(512),email:'😀'.repeat(512)};
 await reviewCustomerContacts(draft,null,customerBusiness,proof(),signal(),list);expect(list.mock.calls[0]![1].search).toHaveLength(200);expect([...list.mock.calls[1]![1].search]).toHaveLength(200);expect(draft.phone).toHaveLength(512);expect([...draft.email]).toHaveLength(512);
});
it('refuses cross-business source evidence and inconsistent versions across the two live searches',async()=>{
 const draft={...emptyCustomerDraft,phone:'15555550123',email:'owner@example.com'},list=vi.fn<typeof customers.list>().mockResolvedValue({customers:[{...match(),business_id:'55555555-5555-4555-8555-555555555555'}],hasMore:false});
 await expect(reviewCustomerContacts(draft,null,customerBusiness,proof(),signal(),list)).rejects.toThrow('CUSTOMER_CONTACT_REVIEW_UNAVAILABLE');
 list.mockResolvedValueOnce({customers:[match()],hasMore:false}).mockResolvedValueOnce({customers:[{...match(),version:'2'}],hasMore:false});await expect(reviewCustomerContacts(draft,null,customerBusiness,proof(),signal(),list)).rejects.toThrow('CUSTOMER_CONTACT_REVIEW_UNAVAILABLE');
});
it('aborted lookup cannot return late private matches or begin another query',async()=>{
 const abort=new AbortController(),list=vi.fn<typeof customers.list>().mockImplementation(async()=>{abort.abort();return {customers:[match()],hasMore:false};});
 await expect(reviewCustomerContacts({...emptyCustomerDraft,phone:'15555550123',email:'owner@example.com'},null,customerBusiness,proof(),abort.signal,list)).rejects.toThrow('CUSTOMER_CONTACT_REVIEW_UNAVAILABLE');expect(list).toHaveBeenCalledTimes(1);
});
