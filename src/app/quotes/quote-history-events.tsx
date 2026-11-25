'use client';
import {useState} from 'react';
import type {parseQuoteHistoryPage,StoredQuoteRevision} from '../../commercial/quote-storage-contract';
import {quoteMoney} from '../../commercial/quote-pricing';
import {QuoteDocument} from './quote-document';

type History=Exclude<ReturnType<typeof parseQuoteHistoryPage>,{state:'absent'}>;
type Event=History['history'][number];
const labels={create:'Draft created',edit:'Draft updated',submit:'Ready for review',approve:'Review approved',send:'Sharing recorded',accept:'Customer acceptance recorded'} as const;
function stage(row:StoredQuoteRevision,action?:Event['action']){
 return action==='approve'?'approved':row.state==='Sent'?'sent':row.state==='Accepted'?'accepted':row.state==='Superseded'?'superseded':row.state==='Ready for Review'?'review':'draft';
}

export function QuoteHistoryEvents({events}:{events:readonly Event[]}){
 if(!events.length)return <p>No saved versions are loaded.</p>;
 return <>
  <p className="field-help">Saved versions stay in their retained order. Recorded times use each version’s saved time zone; exact UTC and references are available below each event. Recording time can differ from when a customer confirmed.</p>
  <ol className="amendment-timeline quote-history-timeline">{events.map((event,index)=>{
   const previous=events[index-1];
   const beforeAction=previous&&event.before&&previous.after.id===event.before.id&&previous.revision===event.before.version?previous.action:undefined;
   return <QuoteVersionEvent key={event.eventId} event={event} beforeAction={beforeAction}/>;
  })}</ol>
 </>;
}

function QuoteVersionEvent({event,beforeAction}:{event:Event;beforeAction:Event['action']|undefined}){
   const [comparing,setComparing]=useState(false);
   const format=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:event.after.timezone});
   return <li>
    <header><strong>{event.after.state==='Superseded'?'Offer superseded':labels[event.action]}</strong><span>Version {event.revision} · {event.after.state}</span></header>
    <p className="amendment-event-time">Recorded <time dateTime={event.at}>{format.format(new Date(event.at))}</time> · {event.after.timezone}</p>
    {event.before&&event.before.total_cents!==event.after.total_cents?<dl className="amendment-event-amounts"><div><dt>Previous total</dt><dd>{quoteMoney(event.before.total_cents)}</dd></div><div><dt>This version</dt><dd>{quoteMoney(event.after.total_cents)}</dd></div></dl>:!event.before?<p className="amendment-event-total">Saved total <strong>{quoteMoney(event.after.total_cents)}</strong></p>:null}
    <details className="amendment-event-content"><summary>Customer preview at this version</summary>
     <QuoteDocument quote={event.after.customer_safe_snapshot} stage={stage(event.after,event.action)}/>
    </details>
    {event.before&&<details className="amendment-event-content quote-history-comparison" onToggle={event=>setComparing(event.currentTarget.open)}><summary>Compare saved customer content</summary>
     {comparing&&<div className="quote-history-comparison-content">
      <section className="quote-history-comparison-version" aria-label={'Before version '+event.revision}><h4>Before · Version {event.before.version}</h4><QuoteDocument quote={event.before.customer_safe_snapshot} contextLabel={'Before version '+event.revision} stage={stage(event.before,beforeAction)}/></section>
      <section className="quote-history-comparison-version" aria-label={'At version '+event.revision}><h4>This version · {event.revision}</h4><QuoteDocument quote={event.after.customer_safe_snapshot} contextLabel={'At version '+event.revision} stage={stage(event.after,event.action)}/></section>
     </div>}
    </details>}
    <details className="amendment-event-evidence"><summary>Exact evidence for version {event.revision}</summary><dl>
     <dt>Recorded (exact UTC)</dt><dd><time dateTime={event.at}>{event.at}</time></dd>
     <dt>Saved time zone</dt><dd>{event.after.timezone}</dd>
     <dt>Recorded by reference</dt><dd>{event.actorId}</dd>
     <dt>Event reference</dt><dd>{event.eventId}</dd>
     <dt>Original operation reference</dt><dd>{event.operationId}</dd>
     <dt>Revision reference</dt><dd>{event.after.id}</dd>
    </dl></details>
   </li>;
}
