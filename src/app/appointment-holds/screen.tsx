'use client';
import {SignInLink} from "../sign-in-link";

import {useEffect,useId,useRef,useState} from 'react';
import {createHoldController,initialHoldView,emptyHoldPayload} from '../../client/appointment-hold-controller';
import {createPendingHoldStore} from '../../client/pending-appointment-hold';
import {holdPayload,holdPayloadKeys} from '../../operations/appointment-hold-contract';
import type {HoldPayload,StoredHold} from '../../operations/appointment-hold-contract';
import {ReferencePicker} from '../leads/reference-picker';
import {followUpCandidates,followUpWall} from '../leads/follow-up-time';
import {NullableText} from '../customers/nullable-text';
import {SavedHoldHistoryDownload} from './saved-history-download';
import {useProposalParties} from './proposal-parties';
function wallFacts(instant:string,zone:string){
 if(!instant)return{local:'',offset:0};
 try{const parts=new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)),get=(type:string)=>parts.find(p=>p.type===type)?.value??'';const local=get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day')+'T'+get('hour')+':'+get('minute')+':'+get('second')+'.'+instant.slice(20,26);return{local,offset:(Date.parse(local+'Z')-Date.parse(instant))/60000};}catch{return{local:'',offset:0};}
}
function TimeChoice({name,value,zone,disabled,change}:{name:string;value:string;zone:string;disabled:boolean;change:(instant:string)=>void}){
 const id=useId(),[wall,setWall]=useState(()=>followUpWall(value,zone)),[candidates,setCandidates]=useState<readonly string[]>([]),[issue,setIssue]=useState('');
 function entered(next:string){setWall(next);const matches=followUpCandidates(next,zone);setCandidates(matches);if(matches.length===1){change(matches[0]!);setIssue('');}else{change('');setIssue(matches.length>1?'This clock time occurs twice. Choose the occurrence below.':'Choose a valid local time. Times in a daylight-saving gap cannot be used.');}}
 return <div className="proposal-field"><label htmlFor={id}>{name}</label><input id={id} aria-describedby={issue?id+'-issue':undefined} type="datetime-local" step="60" value={wall} disabled={disabled} onChange={e=>entered(e.target.value)} required/>{issue&&<p id={id+'-issue'} className="field-help" role="alert">{issue}</p>}{candidates.length>1&&<><label htmlFor={id+'-occurrence'}>{name} occurrence</label><select id={id+'-occurrence'} disabled={disabled} value={candidates.includes(value)?value:''} onChange={e=>{if(candidates.includes(e.target.value)){change(e.target.value);setIssue('');}}} required><option value="">Choose occurrence</option>{candidates.map((candidate,i)=><option key={candidate} value={candidate}>{i===0?'First':'Later'} · {candidate} UTC</option>)}</select></>}</div>;
}
function proposalTime(instant:string,timezone:string,includeDate:boolean){
 return new Intl.DateTimeFormat('en-US',{
  timeZone:timezone,hour:'numeric',minute:'2-digit',
  ...(includeDate?{weekday:'short',month:'short',day:'numeric',year:'numeric'}:{}),
 }).format(new Date(instant));
}
function HoldFacts({row}:{row:StoredHold}){return <dl className="customer-values"><dt>State</dt><dd>{row.state==='withdrawn'?'Withdrawn':'Unconfirmed proposal'}</dd><dt>Proposed start</dt><dd>{row.local_start.replace('T',' ')} · {row.timezone}</dd><dt>Proposed end</dt><dd>{row.local_end.replace('T',' ')} · {row.timezone}</dd><dt>Notes</dt><dd>{row.notes===null?'Not recorded':row.notes===''?'Recorded as empty':row.notes}</dd><dt>Change reason</dt><dd>{row.reason??'Initial proposal'}</dd></dl>;}
function ProposalVersions({rows}:{rows:readonly StoredHold[]}){return <ol className="proposal-history-timeline" role="list" aria-label="Saved proposal versions">{rows.map(row=><li key={row.id} data-sequence={row.sequence}><details><summary><span className="proposal-history-heading"><strong>Version {row.sequence}</strong><span className="proposal-state" data-state={row.state}>{row.state==='withdrawn'?'Withdrawn':'Unconfirmed proposal'}</span></span><span className="proposal-history-recorded">Recorded <time dateTime={row.created_at}>{proposalTime(row.created_at,row.timezone,true)}</time> · {row.timezone}</span><span className="proposal-history-reason">{row.reason??'Initial proposal'}</span></summary><HoldFacts row={row}/><p className="field-help">Exact recorded instant (UTC): <time dateTime={row.created_at}>{row.created_at}</time></p></details></li>)}</ol>;}
export function AppointmentHoldScreen(){
 const [view,setView]=useState(initialHoldView),[formInstance,setFormInstance]=useState(0),current=useRef<ReturnType<typeof createHoldController>|null>(null),status=useRef<HTMLParagraphElement>(null),[deviceZone]=useState(()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC');
 const [withdrawn,setWithdrawn]=useState(false),[pageNumber,setPageNumber]=useState(1);
 const proposalHeading=useRef<HTMLHeadingElement>(null);
 const parties=useProposalParties({businessId:view.businessId,binding:view.binding,rows:view.rows});
 const shownRows=view.rows.filter(row=>(row.state==='withdrawn')===withdrawn);
 const dirty=!!view.draft&&(view.selected?holdPayloadKeys.some(k=>k!=='reason'&&view.draft![k]!==view.selected![k])||view.draft.reason!==null&&view.draft.reason!==view.selected.reason:JSON.stringify(view.draft)!==JSON.stringify(emptyHoldPayload));
 useEffect(()=>{const c=createHoldController({store:createPendingHoldStore({getItem:k=>sessionStorage.getItem(k),setItem:(k,v)=>sessionStorage.setItem(k,v),removeItem:k=>sessionStorage.removeItem(k)}),change:setView});current.current=c;void c.load();const hide=()=>{if(document.visibilityState==='hidden')c.suspend();},leave=()=>c.suspend(),restore=(e:PageTransitionEvent)=>{if(e.persisted)c.suspend();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);window.addEventListener('pageshow',restore);return()=>{c.dispose();current.current=null;document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);window.removeEventListener('pageshow',restore);};},[]);
 useEffect(()=>{if(!dirty&&view.phase!=='pending'&&!view.busy)return;const leaving=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',leaving);return()=>window.removeEventListener('beforeunload',leaving);},[dirty,view.phase,view.busy]);
 function discard(){return !dirty||window.confirm('Discard your unsaved proposal changes? Choose Cancel to keep editing.');}
 async function action(kind:'load'|'more'|'save'|'check'|'retry'|'moreHistory'){
  const c=current.current;if(!c)return;
  await c[kind]();
  if(c!==current.current)return;
  if(kind==='load')setPageNumber(1);
  if(kind==='more'&&c.view().phase==='ready')setPageNumber(page=>page+1);
  status.current?.focus();
 }
 function newProposal(){if(view.busy||view.writesPaused)return;if(discard()){current.current?.create();setFormInstance(n=>n+1);requestAnimationFrame(()=>proposalHeading.current?.focus());}}
 function edit<K extends keyof HoldPayload>(key:K,value:HoldPayload[K]){if(view.draft)current.current?.edit({...view.draft,[key]:value});}
 function time(endpoint:'start'|'end',instant:string){if(!view.draft)return;const f=wallFacts(instant,view.draft.timezone);current.current?.edit({...view.draft,[endpoint==='start'?'start_at':'end_at']:instant,[endpoint==='start'?'local_start':'local_end']:f.local,[endpoint==='start'?'start_offset_minutes':'end_offset_minutes']:f.offset});}
 function zone(timezone:string){if(!view.draft)return;const start=wallFacts(view.draft.start_at,timezone),end=wallFacts(view.draft.end_at,timezone);current.current?.edit({...view.draft,timezone,local_start:start.local,local_end:end.local,start_offset_minutes:start.offset,end_offset_minutes:end.offset});}
 const locked=view.busy||view.writesPaused||view.selected?.state==='withdrawn',withdrawing=view.draft?.state==='withdrawn';
 return <section aria-label="Appointment proposals" aria-busy={view.busy}><p className="proposal-reservation"><span>Time is not reserved</span><a href="/schedule">View confirmed jobs</a></p><p ref={status} tabIndex={-1} role="status">{view.message}</p>
  {view.phase==='ready'&&<>
   {view.writesPaused&&<p className="notice">Changes are paused. You can review retained proposals.</p>}
   <section className="proposal-directory settings-card" aria-labelledby="proposal-list-heading">
    <div className="proposal-toolbar">
     <h2 id="proposal-list-heading">Saved proposals</h2>
     {(shownRows.length>0||withdrawn||view.hasMore||pageNumber>1)&&<button type="button" disabled={view.busy||view.writesPaused} onClick={newProposal}>New unconfirmed proposal</button>}
    </div>
    <div className="proposal-filters" role="group" aria-label="Filter saved proposals">
     <button type="button" className="secondary" aria-pressed={!withdrawn} disabled={view.busy} onClick={()=>setWithdrawn(false)}>Unconfirmed</button>
     <button type="button" className="secondary" aria-pressed={withdrawn} disabled={view.busy} onClick={()=>setWithdrawn(true)}>Withdrawn</button>
    </div>
    {shownRows.length>0?<ul className="proposal-rows">{shownRows.map(row=>{
     const state=row.state==='withdrawn'?'Withdrawn':'Unconfirmed',party=parties.get(row.id);
     return <li key={row.id} data-selected={view.selected?.id===row.id}>
      <div className="proposal-time"><span className="proposal-caption">Proposed time</span>
       <p><time dateTime={row.start_at}>{proposalTime(row.start_at,row.timezone,true)}</time>
        {' – '}<time dateTime={row.end_at}>{proposalTime(row.end_at,row.timezone,row.local_start.slice(0,10)!==row.local_end.slice(0,10))}</time></p>
       <p className="proposal-zone">{row.timezone}</p>
      </div>
      <div className="proposal-party" aria-busy={!party}><span className="proposal-caption">{row.customer_id===null?'Current lead':'Current customer'}</span>
       <strong>{party?.state==='verified'?party.label:party?(row.customer_id===null?'Lead name unavailable':'Customer name unavailable'):(row.customer_id===null?'Checking lead name…':'Checking customer name…')}</strong><p className="proposal-label">{row.label}</p>
      </div>
      <div className="proposal-outcome"><span className="proposal-state" data-state={row.state}>{state}</span><p>{row.state==='withdrawn'?'No longer proposed':'Time is not reserved'}</p></div>
      <button type="button" className="secondary" aria-label={'Review '+row.label+' · '+state} disabled={view.busy} onClick={()=>{
       const controller=current.current;
       if(controller&&discard())void controller.open(row).then(()=>{
        if(controller!==current.current)return;
        setFormInstance(n=>n+1);
        if(controller.view().selected?.id===row.id)requestAnimationFrame(()=>proposalHeading.current?.focus());
       });
      }}>Review</button>
     </li>;
    })}</ul>:<div className="proposal-empty"><h3>{withdrawn?'No withdrawals on this page':'Plan the next visit'}</h3><p role="status">No {withdrawn?'withdrawn':'unconfirmed'} proposals on this page.</p><p>{withdrawn?'Withdrawn times stay in retained history. Switch to Unconfirmed to review current proposals.':'Save a proposed time for an existing customer or lead. The slot stays open until a job is confirmed from accepted quote scope.'}</p>{!withdrawn&&!view.hasMore&&pageNumber===1&&<button type="button" disabled={view.busy||view.writesPaused} onClick={newProposal}>New unconfirmed proposal</button>}</div>}
    {(pageNumber>1||view.hasMore)&&<div className="proposal-pagination">
     <p className="field-help">Page {pageNumber} · Filters apply to this page</p>
     {pageNumber>1&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>{if(discard())void action('load');}}>First proposal page</button>}
     {view.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>{if(discard())void action('more');}}>Next proposal page</button>}
    </div>}
   </section>
   {view.draft&&<section className="proposal-editor settings-card" aria-label="Proposal editor"><h2 ref={proposalHeading} tabIndex={-1}>{view.selected?'Review proposal':'New proposal'}</h2><p className="field-help">Proposed times leave the slot unreserved. Confirm a job from accepted quote scope before starting work.</p>{!view.selected&&view.businessId&&<ReferencePicker businessId={view.businessId} kind="customer" value={view.draft.customer_id} disabled={locked} change={customer_id=>edit('customer_id',customer_id)}/>}<form onSubmit={e=>{e.preventDefault();void action('save');}}><fieldset disabled={locked||withdrawing}>
     <legend>Proposed time</legend>
     <div className="proposal-fields">
      <div className="proposal-field"><label htmlFor="proposal-label">Proposal label</label><input id="proposal-label" value={view.draft.label} maxLength={400} autoComplete="off" onChange={e=>edit('label',e.target.value)} required/></div>
      <div className="proposal-field"><label htmlFor="proposal-zone">Time zone</label><select id="proposal-zone" value={view.draft.timezone} onChange={e=>zone(e.target.value)}>{[...new Set([view.draft.timezone,'America/Indiana/Indianapolis',deviceZone,'UTC'])].map(z=><option key={z} value={z}>{z}</option>)}</select></div>
      <div className="booking-time-fields">
       <TimeChoice key={formInstance+':'+view.draft.timezone+':start'} name="Proposed start" value={view.draft.start_at} zone={view.draft.timezone} disabled={locked||!!withdrawing} change={v=>time('start',v)}/>
       <TimeChoice key={formInstance+':'+view.draft.timezone+':end'} name="Proposed end" value={view.draft.end_at} zone={view.draft.timezone} disabled={locked||!!withdrawing} change={v=>time('end',v)}/>
      </div>
      <p className="field-help">Changing the zone changes the display, preserving the actual instants. Existing seconds and microseconds remain until you edit a time. Review both endpoints before saving.</p>
      <NullableText name="proposal-notes" label="Proposal notes" multiline limit={2000} value={view.draft.notes} disabled={locked||!!withdrawing} change={v=>edit('notes',v)}/>
     </div>
    </fieldset>
    {view.selected&&view.selected.state!=='withdrawn'&&<><label className="trust"><input type="checkbox" checked={withdrawing} disabled={locked} onChange={e=>{if(discard()){current.current?.edit(e.target.checked?{...holdPayload(view.selected!),state:'withdrawn',reason:''}:{...holdPayload(view.selected!),reason:null});setFormInstance(n=>n+1);}}}/>Withdraw this unconfirmed proposal</label><label htmlFor="proposal-reason">Reason for this revision or withdrawal</label><textarea id="proposal-reason" value={view.draft.reason??''} rows={3} maxLength={2000} disabled={locked} onChange={e=>edit('reason',e.target.value)} required/></>}{view.issue&&<p className="field-help">{view.issue}</p>}<button type="submit" disabled={!view.canSave}>Save unconfirmed proposal</button></form></section>}
   {view.history&&<section className="proposal-history settings-card" aria-label="Proposal history"><h2>Retained versions</h2>{view.selected&&<SavedHoldHistoryDownload key={view.selected.id} head={view.selected} disabled={view.busy} archive={async()=>{const c=current.current;if(!c)return;const bytes=await c.archive();if(c!==current.current||c.view().phase!=='ready'){bytes?.fill(0);return;}return bytes;}}/>}<ProposalVersions rows={view.history.versions}/>{view.history.hasMore&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('moreHistory')}>Next proposal history page</button>}</section>}
  </>}
  {view.phase==='pending'&&<><p>Keep the original save reference. Nothing retries automatically.</p><a className="text-action" href="/save-review?kind=operations.appointment_hold.save">Review this original proposal request</a>{view.reference&&<p className="save-reference">Save reference: <code>{view.reference}</code></p>}<button type="button" disabled={view.busy} onClick={()=>void action('check')}>Check proposal save status</button>{view.canRetry&&<button type="button" className="secondary" disabled={view.busy} onClick={()=>void action('retry')}>Retry unchanged original proposal</button>}</>}
  {['review','unavailable','blocked'].includes(view.phase)&&<button type="button" disabled={view.busy} onClick={()=>void action('load')}>Load current proposals</button>}{view.phase==='unavailable'&&<p><SignInLink returnTo="appointment-proposals">Check sign-in</SignInLink></p>}
 </section>;
}
