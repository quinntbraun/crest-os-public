import type {SavedQuoteAmendment} from '../../../commercial/quote-amendment-history';
import {quoteMoney} from '../../../commercial/quote-pricing';
import {QuoteDocument} from '../quote-document';

type Event=SavedQuoteAmendment['history'][number];
const labels={create:'Draft created',edit:'Draft updated',submit:'Ready for review',approve:'Review approved',send:'Sharing recorded',accept:'Customer acceptance recorded'} as const;

export function AmendmentHistoryEvents({events}:{events:readonly Event[]}){
 return <ol className="amendment-timeline">{events.map(event=>{
  const label=event.after.state==='Superseded'?'Offer superseded':labels[event.action];
  const recorded=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:event.after.timezone});
  return <li key={event.eventId}>
   <header><strong>{label}</strong><span>Version {event.revision} · {event.after.state}</span></header>
   <p className="amendment-event-time">Recorded <time dateTime={event.at}>{recorded.format(new Date(event.at))}</time></p>
   {event.before&&event.before.total_cents!==event.after.total_cents?<dl className="amendment-event-amounts"><div><dt>Previous total</dt><dd>{quoteMoney(event.before.total_cents)}</dd></div><div><dt>This version</dt><dd>{quoteMoney(event.after.total_cents)}</dd></div></dl>:!event.before?<p className="amendment-event-total">Saved total <strong>{quoteMoney(event.after.total_cents)}</strong></p>:null}
   <details className="amendment-event-content">
    <summary>Customer content at version {event.revision}</summary>
    <QuoteDocument quote={event.after.customer_safe_snapshot} contextLabel={'Saved version '+event.revision} stage={event.after.state==='Accepted'?'accepted':event.action==='approve'?'approved':event.after.state==='Sent'?'sent':event.after.state==='Superseded'?'superseded':event.after.state==='Ready for Review'?'review':'draft'}/>
   </details>
   <details className="amendment-event-evidence"><summary>Exact evidence for version {event.revision}</summary><dl>
    <dt>Recorded (exact UTC)</dt><dd><time dateTime={event.at}>{event.at}</time></dd>
    <dt>Saved time zone</dt><dd>{event.after.timezone}</dd>
    <dt>Recorded by reference</dt><dd>{event.actorId}</dd>
    <dt>Event reference</dt><dd>{event.eventId}</dd>
    <dt>Operation reference</dt><dd>{event.operationId}</dd>
    <dt>Revision reference</dt><dd>{event.after.id}</dd>
   </dl></details>
  </li>;
 })}</ol>;
}
