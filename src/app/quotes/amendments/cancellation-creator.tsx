'use client';
import {useEffect,useRef} from 'react';
import type {RefObject} from 'react';
import type {createQuoteAmendmentWorkspace,QuoteAmendmentWorkspaceView} from '../../../client/quote-amendment-workspace';

export function AmendmentCancellationCreator({view,controller}:{view:QuoteAmendmentWorkspaceView;controller:RefObject<ReturnType<typeof createQuoteAmendmentWorkspace>|null>}){
 const draft=view.cancellationDraft,reason=useRef<HTMLTextAreaElement>(null),open=draft!==null;
 useEffect(()=>{if(open)reason.current?.focus();},[open]);
 if(!open)return view.canCreate?<button type="button" className="secondary" onClick={()=>controller.current?.startCancellation()}>Prepare cancellation proposal</button>:null;
 return <section className="service-definition-panel" aria-labelledby="cancellation-proposal-heading">
  <h3 id="cancellation-proposal-heading">Propose cancelling all remaining work</h3>
  <p>Save a separate proposal for customer review. This does not cancel accepted work or appointments, issue a credit, or record a refund.</p>
  <form aria-label="New cancellation proposal" onSubmit={event=>{event.preventDefault();void controller.current?.createCancellation();}}>
   <fieldset disabled={view.busy||view.writesPaused}>
    <label htmlFor="cancellation-proposal-reason">Reason the customer will see</label>
    <textarea ref={reason} id="cancellation-proposal-reason" value={draft.reason} rows={4} maxLength={4000} required aria-describedby="cancellation-proposal-help cancellation-proposal-validation" aria-invalid={draft.reason.length>0&&!!draft.issue} onChange={event=>controller.current?.editCancellationReason(event.target.value)}/>
    <p id="cancellation-proposal-help" className="field-help">Up to 2,000 characters. Accepted contact details, location and terms are copied; this new proposal has no expiry. Draft wording stays only on this page until saved.</p>
    <p id="cancellation-proposal-validation" className="field-help">{draft.issue||'Ready to save as a Draft. Review and owner approval are separate steps.'}</p>
    <div className="amendment-actions"><button type="submit" disabled={!view.canSaveCancellation}>Save cancellation proposal</button><button type="button" className="secondary" onClick={()=>controller.current?.discardCancellation()}>Discard unsaved proposal</button></div>
   </fieldset>
  </form>
  <p className="field-help">Record actual sharing only after the proposal is approved and shared with the customer. Customer acceptance remains unfinished; saving, approving or sharing this Draft does not itself cancel accepted work.</p>
 </section>;
}
