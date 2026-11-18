import type {Lead,LeadSource} from '../../customer/lead-contract';
import type {LeadEditorView} from '../../client/lead-editor-controller';
import {leadDollars} from './intake-input';
import {leadHistoryChanges,leadHistoryFields} from './history-presentation';

const recordedTime=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'medium',timeZone:'UTC'});
type Field=typeof leadHistoryFields[number][0];
function SourceSnapshot({source}:{source:LeadSource}){
 return <dl className="lead-source-snapshot">
  <dt>Source label</dt><dd>{source.label}</dd><dt>Source kind</dt><dd>{source.kind}</dd>
  <dt>Source version</dt><dd>{source.version}</dd><dt>Source status</dt><dd>{source.active?'Active':'Inactive'}</dd>
  <dt>Source reference</dt><dd>{source.id}</dd><dt>Referral customer reference</dt><dd>{source.referral_customer_id??'Not recorded'}</dd>
  <dt>Source recorded (UTC)</dt><dd><time dateTime={source.updated_at}>{source.updated_at}</time></dd>
  <dt>Normalized source label</dt><dd>{source.label_normalized}</dd><dt>Business reference</dt><dd>{source.business_id}</dd>
  <dt>Source created (UTC)</dt><dd>{source.created_at}</dd><dt>Source created by reference</dt><dd>{source.created_by}</dd>
  <dt>Source recorded by reference</dt><dd>{source.updated_by}</dd><dt>Source operation reference</dt><dd>{source.operation_id}</dd>
  <dt>Source origin</dt><dd>{source.origin}</dd><dt>Source import reference</dt><dd>{source.import_row_id??'Not recorded'}</dd>
 </dl>;
}
function Value({field,value}:{field:Field;value:Lead[Field]}){
 if(value===null)return <>Not recorded</>;
 if(typeof value==='object')return <SourceSnapshot source={value}/>;
 if(value==='')return <>Recorded as empty</>;
 if(field==='estimated_cents')return <>${leadDollars(value)}</>;
 if(field==='state')return <>{value.replaceAll('_',' ')}</>;
 return <>{value}</>;
}
function Facts({items,side,context}:{items:readonly {key:Field;label:string;before:Lead[Field];after:Lead[Field]}[];side:'before'|'after';context:string}){
 return <dl className="lead-history-facts">{items.map(item=>{const value=item[side],long=typeof value==='string'&&value.length>240;return <div key={item.key}>
  <dt>{item.label}</dt><dd><div className={long?'lead-history-long-value':undefined} role={long?'region':undefined} tabIndex={long?0:undefined} aria-label={long?context+': '+item.label:undefined}><Value field={item.key} value={value}/></div></dd>
 </div>;})}</dl>;
}
function Snapshot({lead,context}:{lead:Lead;context:string}){
 const items=leadHistoryFields.map(([key,label])=>({key,label,before:lead[key],after:lead[key]}));
 return <><Facts items={items} side="after" context={context}/><dl className="lead-history-evidence">
  <dt>Lead reference</dt><dd>{lead.id}</dd><dt>Business reference</dt><dd>{lead.business_id}</dd>
  <dt>Normalized phone</dt><dd>{lead.phone_normalized??'Not recorded'}</dd><dt>Normalized email</dt><dd>{lead.email_normalized??'Not recorded'}</dd>
  <dt>Origin</dt><dd>{lead.origin}</dd><dt>Import reference</dt><dd>{lead.import_row_id??'Not recorded'}</dd>
  <dt>Created (UTC)</dt><dd>{lead.created_at}</dd><dt>Created by reference</dt><dd>{lead.created_by}</dd>
  <dt>Recorded (UTC)</dt><dd>{lead.updated_at}</dd><dt>Recorded by reference</dt><dd>{lead.updated_by}</dd>
  <dt>Operation reference</dt><dd>{lead.operation_id}</dd><dt>Version</dt><dd>{lead.version}</dd>
 </dl></>;
}
export function LeadHistory({history,busy,onMore}:{history:NonNullable<LeadEditorView['history']>;busy:boolean;onMore:()=>void}){
 const entries=history.history,first=entries[0]?.after.version,last=entries.at(-1)?.after.version;
 return <section id="lead-history" tabIndex={-1} aria-label="Lead history" className="lead-history">
  <h2>Retained history</h2><p>Current version: {history.lead.version}</p>
  <p className="field-help">{first?'Loaded versions '+first+'–'+last+'.':'No versions on this loaded page.'} {history.hasMore?'Later versions are available.':'No later versions in this loaded history.'} {first&&first!=='1'?'Reopen this lead to return to its first history page.':''}</p>
  <p className="field-help">Times show when each version was recorded, in UTC. Original status-change reasons are in Status history.</p>
  <ol className="lead-history-events">{entries.map(event=>{const changes=leadHistoryChanges(event.before,event.after),title=event.action==='create'?'Lead created':event.action==='state_change'?'Status changed':'Intake updated';return <li key={event.after.version}>
   <details className="lead-history-event">
    <summary><strong>{title}</strong><span>Version {event.after.version} · <time dateTime={event.at}>{recordedTime.format(new Date(event.at))} UTC</time></span></summary>
    {event.before?<>
     {changes?.length?<div className="lead-history-values" role="group" aria-label="Changed lead facts">
      <section role="group" aria-label="Before"><h3>Before</h3><Facts items={changes} side="before" context={'Before changes at version '+event.after.version}/></section>
      <section role="group" aria-label="After"><h3>After</h3><Facts items={changes} side="after" context={'After changes at version '+event.after.version}/></section>
     </div>:<p className="field-help">{changes===null?'A change summary is unavailable for this retained version.':'No intake or status fields changed in this version.'}</p>}
     <details className="lead-history-retained"><summary>Retained lead details at version {event.after.version}</summary><div className="lead-history-values">
      <section role="group" aria-label="Retained earlier lead"><h3>Before</h3><Snapshot lead={event.before} context={'Earlier lead for version '+event.after.version}/></section>
      <section role="group" aria-label="Retained resulting lead"><h3>After</h3><Snapshot lead={event.after} context={'Resulting lead for version '+event.after.version}/></section>
     </div></details>
    </>:<section role="group" aria-label="Created lead"><h3>Created lead</h3><Snapshot lead={event.after} context={'Created lead at version '+event.after.version}/></section>}
    <dl className="lead-history-evidence"><dt>Recorded (exact UTC)</dt><dd><time dateTime={event.at}>{event.at}</time></dd><dt>Recorded by reference</dt><dd>{event.actorId}</dd><dt>Event reference</dt><dd>{event.eventId}</dd><dt>Operation reference</dt><dd>{event.operationId}</dd></dl>
   </details>
  </li>;})}</ol>
  {history.hasMore&&<button className="secondary" type="button" disabled={busy} onClick={onMore}>Next lead history page</button>}
 </section>;
}
