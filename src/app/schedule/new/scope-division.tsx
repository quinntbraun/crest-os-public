'use client';
import {useId} from 'react';
import {divideBookingPart,hasBookingDivision} from '../../../client/booking-scope-division';
import type {BookingDivision} from '../../../client/booking-scope-division';
import type {CurrentBookingSource} from '../../../operations/booking-context-contract';
import type {AllocationPart} from '../../../operations/scope-allocation-plan';
import {quoteMoney} from '../../../commercial/quote-pricing';

export function ScopeDivision({source,part,jobId,draft,change}:{source:CurrentBookingSource;part:AllocationPart;jobId:string;draft:BookingDivision|undefined;change:(patch:Partial<BookingDivision>)=>void}){
 const prefix=useId();let preview:readonly AllocationPart[]|null=null;
 if(hasBookingDivision(draft))try{preview=divideBookingPart(source,part,jobId,draft!);}catch{/* Incomplete private entries remain editable; no save is inferred. */}
 return <details className="scope-division"><summary>Divide this work between visits</summary><p>Allocate the accepted {quoteMoney(part.amountCents)} and describe the work for each visit. This changes neither the agreement nor when money is owed.</p><p className="field-help">Leave all division fields blank to assign the whole part. Complete them to divide it; nothing saves until you confirm the booking.</p>
  <label htmlFor={prefix+'-amount'}>Amount for this visit (USD)</label><input id={prefix+'-amount'} inputMode="decimal" maxLength={20} autoComplete="off" value={draft?.amount??''} onChange={event=>change({amount:event.target.value})}/>
  {part.discountInclusiveCents!=='0'&&<><p className="field-help">This part includes {quoteMoney(part.discountInclusiveCents)} of agreed discount. Choose its exact allocation; Crest does not distribute it automatically.</p><label htmlFor={prefix+'-discount'}>Agreed discount allocated to this visit (USD)</label><input id={prefix+'-discount'} inputMode="decimal" maxLength={20} autoComplete="off" value={draft?.discount??''} onChange={event=>change({discount:event.target.value})}/></>}
  <label htmlFor={prefix+'-visit'}>Work included in this visit</label><textarea id={prefix+'-visit'} rows={2} maxLength={2000} value={draft?.visitScope??''} onChange={event=>change({visitScope:event.target.value})}/>
  <label htmlFor={prefix+'-remaining'}>Work remaining for a later visit</label><textarea id={prefix+'-remaining'} rows={2} maxLength={2000} value={draft?.remainingScope??''} onChange={event=>change({remainingScope:event.target.value})}/>
  {preview?<p role="status">This visit: {quoteMoney(preview[0]!.amountCents)}. Unassigned for later: {quoteMoney(preview[1]!.amountCents)}. Accepted total unchanged.</p>:hasBookingDivision(draft)&&<p className="field-help">Complete both descriptions and the exact amount{part.discountInclusiveCents!=='0'?' and discount allocation':''} before booking. Allocations cannot exceed the accepted part.</p>}
 </details>;
}
