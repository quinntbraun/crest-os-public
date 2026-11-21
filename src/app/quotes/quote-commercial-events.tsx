import type {QuoteCommercialState} from '../../commercial/quote-commercial-read';

export function QuoteCommercialEvents({saved,timezone}:{saved:QuoteCommercialState;timezone:string}){
 if(!saved.approval)return null;
 const format=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:timezone});
 const when=(value:string)=><time dateTime={value}>{format.format(new Date(value))}</time>;
 return <section className="quote-commercial-events" aria-labelledby="quote-commercial-events-heading">
  <h4 id="quote-commercial-events-heading">Key saved events</h4>
  <p className="field-help">Approval prepares the document. Actual sharing and customer confirmation are recorded separately. Times shown in {timezone}; expand an event for exact UTC evidence. These are key milestones, with only the latest sharing shown. Saved quote history retains earlier versions.</p>
  <ol>
   <li><strong>Document approved</strong>{when(saved.approval.reviewedAt)}
    <details className="quote-event-evidence"><summary>Approval evidence</summary><dl>
     <dt>Approved (exact UTC)</dt><dd><time dateTime={saved.approval.reviewedAt}>{saved.approval.reviewedAt}</time></dd>
     <dt>Approved by reference</dt><dd>{saved.approval.actorId}</dd>
     <dt>Approval reference</dt><dd>{saved.approval.id}</dd>
     <dt>Audit event reference</dt><dd>{saved.approval.auditEventId}</dd>
    </dl></details>
   </li>
   {saved.latestSend&&<li><strong>Last actual sharing</strong>{when(saved.latestSend.confirmedAt)}
    <p>{saved.latestSend.channel.replace('_',' ')} · {saved.latestSend.recipientSnapshot.displayName}</p>
    <details className="quote-event-evidence"><summary>Sharing evidence</summary>
     {saved.latestSend.evidenceNote&&<p className="service-scope">{saved.latestSend.evidenceNote}</p>}
     <dl><dt>Sharing recorded (exact UTC)</dt><dd><time dateTime={saved.latestSend.confirmedAt}>{saved.latestSend.confirmedAt}</time></dd>
      <dt>Sharing reference</dt><dd>{saved.latestSend.id}</dd><dt>Audit event reference</dt><dd>{saved.latestSend.auditEventId}</dd></dl>
    </details>
   </li>}
   {saved.acceptance&&<>
    <li><strong>Customer confirmation</strong>{when(saved.acceptance.confirmationEffectiveAt)}
     <p>{saved.acceptance.counterpartySnapshot.displayName} · {saved.acceptance.channel.replace('_',' ')}</p>
     <details className="quote-event-evidence"><summary>Confirmation time evidence</summary><dl>
      <dt>Customer confirmation (exact UTC)</dt><dd><time dateTime={saved.acceptance.confirmationEffectiveAt}>{saved.acceptance.confirmationEffectiveAt}</time></dd>
      <dt>Acceptance reference</dt><dd>{saved.acceptance.id}</dd>
     </dl></details>
    </li>
    <li><strong>Recorded in Crest</strong>{when(saved.acceptance.recordedAt)}
     <p className="field-help">Recording time is separate from when the customer confirmed.</p>
     <details className="quote-event-evidence"><summary>Recording evidence</summary><dl>
      <dt>Recorded (exact UTC)</dt><dd><time dateTime={saved.acceptance.recordedAt}>{saved.acceptance.recordedAt}</time></dd>
      <dt>Original operation reference</dt><dd>{saved.acceptance.operationId}</dd>
      <dt>Audit event reference</dt><dd>{saved.acceptance.auditEventId}</dd>
     </dl></details>
    </li>
   </>}
  </ol>
 </section>;
}
