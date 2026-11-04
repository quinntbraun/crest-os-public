'use client';
import {useState} from 'react';
import type {RefObject} from 'react';
import type {createQuoteAmendmentWorkspace,QuoteAmendmentWorkspaceView} from '../../../client/quote-amendment-workspace';
import type {QuoteConfirmationChannel} from '../../../commercial/quote-commercial-contract';
import {QuoteDocument} from '../quote-document';
import {PhoneInput} from '../../customers/phone-input';

export function AmendmentReviewAndSharing({view,controller}:{view:QuoteAmendmentWorkspaceView;controller:RefObject<ReturnType<typeof createQuoteAmendmentWorkspace>|null>}){
 const amendment=view.amendment,[extreme,setExtreme]=useState(false),[channel,setChannel]=useState<''|QuoteConfirmationChannel>(''),[name,setName]=useState(amendment?.revision.customer_safe_snapshot.recipient.displayName??''),[phone,setPhone]=useState(amendment?.revision.customer_safe_snapshot.recipient.phone??''),[email,setEmail]=useState(amendment?.revision.customer_safe_snapshot.recipient.email??''),[note,setNote]=useState(''),[actual,setActual]=useState(false);
 if(!amendment)return null;const nullable=(value:string)=>value.trim()?value:null;
 return <section aria-label="Amendment review and sharing"><h3>Review and approval</h3>
  {view.dirty&&<p className="notice">Save your edits before requesting review, approval or sharing. The comparison above still shows the saved proposal.</p>}
  {view.reviewIssue&&['Draft','Ready for Review'].includes(amendment.revision.state)&&<p className="notice">{view.reviewIssue}</p>}
  {amendment.revision.state==='Draft'&&<button type="button" disabled={!view.canSubmit} onClick={()=>void controller.current?.review('submit')}>Request review of saved amendment</button>}
  {amendment.revision.state==='Ready for Review'&&!amendment.approval&&<>
   {view.hasExtreme&&<label className="checkbox"><input type="checkbox" checked={extreme} disabled={!view.canApprove} onChange={event=>setExtreme(event.target.checked)}/>I reviewed the Extreme condition and exact proposed scope.</label>}
   <button type="button" disabled={!view.canApprove||view.hasExtreme&&!extreme} onClick={()=>void controller.current?.review('approve',extreme)}>Approve this exact amendment</button>
  </>}
  {amendment.approval&&<details><summary>Retained approved customer content</summary><QuoteDocument quote={amendment.approval.customerRepresentation} stage="approved"/><p className="field-help">Approval records review of this exact content. It does not establish actual sharing or customer acceptance.</p></details>}
  {amendment.revision.state==='Ready for Review'&&amendment.approval&&<details><summary>Record actual sharing</summary>
   <p>Share the approved proposal with the customer using your own channel, then record what actually happened. This form does not send a message.</p>
   {amendment.control.activeOfferId!==null&&<p className="notice">Recording this replacement’s actual sharing withdraws the earlier shared offer. The accepted agreement stays in force.</p>}
   <form aria-label="Actual amendment sharing" onSubmit={event=>{event.preventDefault();if(!channel||!actual)return;void controller.current?.send({channel,recipientSnapshot:{displayName:name,phone:nullable(phone),email:nullable(email)},evidenceNote:nullable(note),confirmedActualSharing:true});}}><fieldset disabled={!view.canSend}>
    <label htmlFor="amendment-sharing-channel">Actual sharing channel</label><select id="amendment-sharing-channel" value={channel} required onChange={event=>setChannel(event.target.value as ''|QuoteConfirmationChannel)}><option value="">Choose the actual channel</option><option value="text">Text message</option><option value="phone">Phone</option><option value="email">Email</option><option value="in_person">In person</option></select>
    <label>Shared with<input value={name} maxLength={200} required onChange={event=>setName(event.target.value)}/></label>
    <details><summary>Recipient contact details (optional)</summary><fieldset><legend>Phone (optional)</legend><PhoneInput name="amendment-sharing-phone" value={phone} limit={512} change={setPhone}/></fieldset><label>Email<input type="email" inputMode="email" value={email} maxLength={512} onChange={event=>setEmail(event.target.value)}/></label></details>
    <label>Sharing evidence note (optional)<textarea rows={3} value={note} maxLength={8000} onChange={event=>setNote(event.target.value)}/></label>
    <label className="checkbox"><input type="checkbox" checked={actual} onChange={event=>setActual(event.target.checked)}/>I actually shared this exact approved amendment with this recipient.</label>
    <button type="submit" disabled={!view.canSend||!actual||!channel||!name.trim()}>Record actual amendment sharing</button>
   </fieldset></form>
  </details>}
  {amendment.latestSend&&<details><summary>Recorded sharing</summary><p>{amendment.latestSend.channel.replaceAll('_',' ')} · {amendment.latestSend.recipientSnapshot.displayName}</p><p className="notice">Sharing is recorded. The accepted agreement is unchanged until separate customer acceptance; recording amendment acceptance is not available in this build.</p></details>}
 </section>;
}
