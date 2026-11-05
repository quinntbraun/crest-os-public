import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {reopeningQuoteDraft} from '../../src/client/quote-amendment-workspace';
import {parseQuoteDraft,quoteDraftIssue} from '../../src/client/quote-draft';
import {cancellationAppFixture} from './quote-cancellation-app-fixture';
function fixture(){const f=cancellationAppFixture(),customerId=f.target.parent.customerId;if(customerId===null)throw Error('SYNTHETIC_CUSTOMER_REQUIRED');return {...f,target:{...f.target,parent:{...f.target.parent,customerId,revision:{...f.target.revision,state:'Accepted' as const}}}};}
it('starts new work with retained customer metadata and no invented scope, amount, discount, expiry or appointment',()=>{
 const f=fixture(),draft=reopeningQuoteDraft(f.target);expect(draft).toMatchObject({contentSchemaVersion:2,customerId:f.target.parent.customerId,recipientName:f.p.customer.recipient.displayName,workLocation:f.p.customer.workLocation,terms:f.p.customer.terms,timezone:f.p.customer.timezone,lines:[],discountKind:'none',discount:'',expiryAt:'',proposedSchedule:''});expect(draft).not.toHaveProperty('cancellationReason');expect(quoteDraftIssue(draft)).toBe('Add at least one scoped line.');expect(()=>parseQuoteDraft(draft)).toThrow();
});
it('requires the cancellation customer to match the selected accepted customer',()=>{const f=fixture();expect(()=>reopeningQuoteDraft({...f.target,parent:{...f.target.parent,customerId:randomUUID()}})).toThrow('AMENDMENT_REOPENING_PARENT_REQUIRED');});
it('refuses to reinterpret an ordinary accepted quote as an empty cancelled parent',()=>{const f=fixture();expect(()=>reopeningQuoteDraft({parent:{...f.f.target.parent,customerId:f.target.parent.customerId}})).toThrow();});
it('keeps the private preparation frozen and separate from later source edits',()=>{
 const source=structuredClone(fixture().target),draft=reopeningQuoteDraft(source),recipient=structuredClone(source.parent.revision.customer_safe_snapshot.recipient);Object.assign(source.parent.revision.customer_safe_snapshot.recipient,{displayName:'PRIVATE_LATER_SOURCE_CHANGE'});expect(draft.recipientName).toBe(recipient.displayName);expect(Object.isFrozen(draft)).toBe(true);expect(Object.isFrozen(draft.lines)).toBe(true);expect(JSON.stringify(draft)).not.toContain('PRIVATE_LATER_SOURCE_CHANGE');
});
