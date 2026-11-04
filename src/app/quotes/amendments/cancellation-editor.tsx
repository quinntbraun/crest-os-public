'use client';
import type {RefObject} from 'react';
import type {createQuoteAmendmentWorkspace,QuoteAmendmentWorkspaceView} from '../../../client/quote-amendment-workspace';
export function AmendmentCancellationEditor({view,controller}:{view:QuoteAmendmentWorkspaceView;controller:RefObject<ReturnType<typeof createQuoteAmendmentWorkspace>|null>}){
 const draft=view.cancellationEdit;if(!draft||!view.amendment||!['Draft','Ready for Review'].includes(view.amendment.revision.state))return null;
 return <details className="service-definition-panel"><summary>Edit cancellation reason</summary>
  <p className="field-help">{view.dirty?'Unsaved changes stay only on this page.':'Showing the saved reason.'} Saving returns this proposal to Draft. Its previous approval stays in history and fresh review and approval are required.</p>
  <form aria-label="Edit cancellation proposal" onSubmit={event=>{event.preventDefault();void controller.current?.saveCancellationEdit();}}><fieldset disabled={!view.canEditCancellation}>
   <label htmlFor="cancellation-edit-reason">Reason the customer will see</label><textarea id="cancellation-edit-reason" value={draft.reason} rows={4} maxLength={4000} required aria-describedby="cancellation-edit-help" aria-invalid={!!draft.issue} onChange={event=>controller.current?.editSavedCancellationReason(event.target.value)}/>
   <p id="cancellation-edit-help" className="field-help">{draft.issue||'Up to 2,000 characters. The saved comparison and history exclude these unsaved edits.'}</p>
   <div className="amendment-actions"><button type="submit" disabled={!view.canSaveCancellationEdit}>Save cancellation changes</button><button type="button" className="secondary" disabled={!view.dirty} onClick={()=>controller.current?.resetCancellationEdit()}>Discard unsaved edits</button></div>
  </fieldset></form>
  <p className="field-help">Saving this proposal does not change accepted work, booked visits or financial history. Actual sharing and customer acceptance are separate steps.</p>
 </details>;
}
