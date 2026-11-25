import type {LoadedJobWorkTime} from '../../../../operations/job-work-time-contract';
import {scheduleInstantMicroseconds} from '../../../../operations/schedule-time';
import {workIntervalChain,workIntervalChanges,workTimeDuration} from './work-time-presentation';
import type {SavedWorkInterval} from './work-time-presentation';
const kinds={open:'Opened',record:'Recorded',close:'Closed',correct:'Corrected'};
export function WorkIntervalHistory({data,current,timezone,when}:{data:LoadedJobWorkTime;current:SavedWorkInterval;timezone:string;when:(value:string)=>string}){
 const rows=workIntervalChain(data,current);
 if(!rows)return <p>Retained interval versions could not be related here.</p>;
 const time=(value:string)=><time dateTime={value} title={value}>{when(value)}</time>;
 const value=(key:string,raw:string|null)=>raw===null?'Not recorded':key==='kind'?raw==='active'?'Active work':'Pause':key==='startedAt'||key==='endedAt'?<>{time(raw)}<small>{raw}</small></>:raw;
 return <details className="work-interval-history"><summary>Retained versions ({rows.length})</summary>
  <p className="field-help">This interval only · {timezone}. Earlier open versions do not have a closed duration.</p>
  <ol aria-label="Retained interval versions">{rows.map((row,index)=>{
   const changes=workIntervalChanges(rows[index-1],row),latest=row.versionId===current.versionId;
   const elapsed=row.endedAt?scheduleInstantMicroseconds(row.endedAt)-scheduleInstantMicroseconds(row.startedAt):latest?scheduleInstantMicroseconds(data.record.observedAt)-scheduleInstantMicroseconds(row.startedAt):null;
   return <li key={row.versionId}>
    <header><strong>Version {row.sequence} · {kinds[row.changeKind]}</strong>{latest&&<span>Current saved version</span>}<p>Recorded {time(row.recordedAt)}</p></header>
    <dl className="work-history-facts"><div><dt>Start</dt><dd>{time(row.startedAt)}</dd></div><div><dt>End</dt><dd>{row.endedAt?time(row.endedAt):'Open when recorded'}</dd></div><div><dt>Duration</dt><dd>{elapsed===null?'Not closed in this version':workTimeDuration(elapsed.toString())}{!row.endedAt&&latest&&<small>As of {time(data.record.observedAt)}</small>}</dd></div></dl>
    {row.pauseReason&&<p className="work-time-reason"><span>Pause reason</span>{row.pauseReason}</p>}
    {row.recordReason&&<p className="work-time-reason"><span>Record note</span>{row.recordReason}</p>}
    {changes&&changes.length>0&&<section aria-label={'Changes in interval version '+row.sequence}><h5>Changes from version {rows[index-1]!.sequence}</h5><dl className="work-history-changes">{changes.map(change=><div key={change.key}><dt>{change.label}</dt><dd><span>Before</span><p>{value(change.key,change.before)}</p></dd><dd><span>This version</span><p>{value(change.key,change.after)}</p></dd></div>)}</dl></section>}
    <details className="work-history-exact"><summary>Exact evidence for interval version {row.sequence}</summary><dl><div><dt>Start (UTC)</dt><dd>{row.startedAt}</dd></div><div><dt>End (UTC)</dt><dd>{row.endedAt??'Open when recorded'}</dd></div><div><dt>Recorded (UTC)</dt><dd>{row.recordedAt}</dd></div><div><dt>Interval reference</dt><dd>{row.intervalId}</dd></div><div><dt>Version reference</dt><dd>{row.versionId}</dd></div>{row.replacesVersionId&&<div><dt>Replaces version reference</dt><dd>{row.replacesVersionId}</dd></div>}</dl></details>
   </li>;
  }).reverse()}</ol>
 </details>;
}
