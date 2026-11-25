import type {DropoffCustody} from '../../operations/dropoff-custody-contract';
import {DropoffPhotoViewer} from './dropoff-photo-fields';

export function CustodyEventTimeline({record,timezone,photos,jobVehicleId}:{record:DropoffCustody;timezone:string;photos:boolean;jobVehicleId:string}){
 const time=(value:string)=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'medium',timeZone:timezone}).format(new Date(value));
 return <section className="custody-event-history" aria-label="Saved handoff timeline">
  <h5>Saved handoffs</h5><p className="field-help">Time zone: {timezone}. Actual handoff and recorded times are shown separately.</p>
  {record.events.length===0?<p>No handoff events recorded.</p>:<ol className="custody-event-timeline" aria-label="Recorded vehicle handoffs">{record.events.map(event=><li key={event.eventId}>
   <header><strong>{event.action==='received'?'Received':'Released'}</strong><p>Actual handoff <time dateTime={event.effectiveAt} title={event.effectiveAt}>{time(event.effectiveAt)}</time></p></header>
   <dl className="custody-handoff-facts"><div><dt>{event.action==='received'?'Handed over by':'Collected by'}</dt><dd>{event.person.displayName}</dd></div><div><dt>Location</dt><dd>{event.location.locationText}{event.location.instructions&&<p>{event.location.instructions}</p>}</dd></div></dl>
   <section className="custody-handoff-photo" aria-label={'Condition evidence for handoff '+event.version}>
    <h6>Condition photo</h6>{event.missingPhotoReason!==null?<p><strong>Missing</strong> · {event.missingPhotoReason}</p>:<><p>Verified condition photo linked</p>{'conditionPhotoId'in event&&typeof event.conditionPhotoId==='string'&&<>{photos?<DropoffPhotoViewer jobVehicleId={jobVehicleId} photoId={event.conditionPhotoId}/>:<p className="field-help">Photo viewing is unavailable in this workspace.</p>}</>}</>}
   </section>
   {event.notes&&<section className="custody-handoff-notes" aria-label={'Notes for handoff '+event.version}><h6>Notes</h6><p>{event.notes}</p></section>}
   {event.acknowledgementConfirmed&&<p className="custody-handoff-acknowledgement">Saved policy acknowledgement recorded</p>}
   <p className="custody-handoff-recorded">Recorded <time dateTime={event.recordedAt} title={event.recordedAt}>{time(event.recordedAt)}</time></p>
   <details className="custody-handoff-evidence"><summary>Exact evidence for handoff {event.version}</summary><dl><div><dt>Actual handoff time (UTC)</dt><dd><time dateTime={event.effectiveAt}>{event.effectiveAt}</time></dd></div><div><dt>Recorded time (UTC)</dt><dd><time dateTime={event.recordedAt}>{event.recordedAt}</time></dd></div><div><dt>Event reference</dt><dd>{event.eventId}</dd></div><div><dt>Saved policy reference</dt><dd>{event.authorizationConfigId}</dd></div>{'conditionPhotoId'in event&&typeof event.conditionPhotoId==='string'&&<div><dt>Condition photo reference</dt><dd>{event.conditionPhotoId}</dd></div>}</dl></details>
  </li>)}</ol>}
 </section>;
}
