'use client';
import {useEffect,useRef,useState} from 'react';
import {authentication} from '../client/authentication';
import {postScheduling} from '../client/scheduling-transport';
import {parseReviewMessageHistory} from '../operations/review-message-history-contract';
import type {
 ReviewHistoryCursor,ReviewHistoryEntry,ReviewHistoryScope,
} from '../operations/review-message-history-contract';

const labels={
 prepared:'Prepared',
 opened:'Opened',
 owner_confirmed_sent:'Owner-confirmed sent',
 failed:'Sending failed',
 skipped:'Skipped',
 pending:'Pending',
} satisfies Record<ReviewHistoryEntry['kind'],string>;
const suppressed={
 owner_skipped:'Skipped by owner',
 outreach_opt_out:'Customer opted out',
 no_contact:'Contact unavailable',
 missing_review_url:'Review link unavailable',
 contact_review_required:'Contact needs review',
 duplicate_encounter:'An existing request needs review',
 template_disabled:'Review template unavailable',
} satisfies Record<NonNullable<ReviewHistoryEntry['suppression']>,string>;

type HistoryView={
 entries:readonly ReviewHistoryEntry[];
 next:ReviewHistoryCursor|null;
 status:'idle'|'loading'|'ready'|'unavailable';
};
const empty:HistoryView={entries:[],next:null,status:'idle'};
const entryKey=(entry:ReviewHistoryEntry)=>entry.source+':'+entry.id;

export function ReviewMessageHistory({businessId,scope}:{
 businessId:string;
 scope:ReviewHistoryScope;
}){
 const [view,setView]=useState(empty);
 const active=useRef<AbortController|null>(null),details=useRef<HTMLDetailsElement>(null);

 useEffect(()=>{
  const clear=()=>{
   active.current?.abort();
   active.current=null;
   if(details.current)details.current.open=false;
   setView(empty);
  };
  const hidden=()=>{if(document.visibilityState==='hidden')clear();};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)clear();};
  document.addEventListener('visibilitychange',hidden);
  window.addEventListener('pagehide',clear);
  window.addEventListener('pageshow',restored);
  return ()=>{
   active.current?.abort();
   active.current=null;
   document.removeEventListener('visibilitychange',hidden);
   window.removeEventListener('pagehide',clear);
   window.removeEventListener('pageshow',restored);
  };
 },[]);

 async function read(cursor:ReviewHistoryCursor|null){
  if(active.current||document.visibilityState==='hidden')return;
  const request=new AbortController();
  active.current=request;
  setView({...view,status:'loading'});
  try{
   const proof=await authentication.session(request.signal);
   const response=await postScheduling('review-history',{
    scopeKind:scope.kind,scopeId:scope.id,cursorSource:cursor?.source??null,cursorId:cursor?.id??null,
   },proof,request.signal);
   if(response.status!==200)throw Error('REVIEW_HISTORY_UNAVAILABLE');
   const page=parseReviewMessageHistory(response.value,businessId,scope);
   if(request.signal.aborted||active.current!==request||!details.current?.open)return;
   const entries=cursor?[...view.entries,...page.entries]:page.entries;
   if(new Set(entries.map(entryKey)).size!==entries.length)throw Error('REVIEW_HISTORY_PAGE_CONFLICT');
   setView({entries,next:page.next,status:'ready'});
  }catch{
   if(!request.signal.aborted&&active.current===request)setView({...view,status:'unavailable'});
  }finally{
   if(active.current===request)active.current=null;
  }
 }

 return <details className="review-message-history" ref={details} onToggle={event=>{
  if(event.currentTarget.open){
   if(view.status==='idle')void read(null);
  }else{
   active.current?.abort();
   active.current=null;
   setView(empty);
  }
 }}>
  <summary>Review message history</summary>
  <div aria-busy={view.status==='loading'}>
   {view.status==='loading'&&<p role="status">Loading saved message history…</p>}
   {view.status==='ready'&&!view.entries.length&&<p>No review messages or requests recorded yet.</p>}
   {view.status==='unavailable'&&<p role="alert">Couldn’t load saved message history.</p>}
   {view.entries.length>0&&<ol>
    {view.entries.map(entry=><li key={entryKey(entry)} className="completion-text">
     <strong>{labels[entry.kind]}</strong> · <time dateTime={entry.effectiveAt}>{new Date(entry.effectiveAt).toLocaleString()}</time>
     {entry.channel&&<span> · {entry.channel==='text'?'Text':'Email'}</span>}
     {entry.suppression&&<p>{suppressed[entry.suppression]}</p>}
     {entry.reason&&<p>{entry.reason}</p>}
     {scope.kind==='customer'&&<p><a href={'/schedule/work/complete?job='+entry.jobId}>Open job completion</a></p>}
    </li>)}
   </ol>}
   {(view.next||view.status==='unavailable')&&<button className="secondary" type="button"
    disabled={view.status==='loading'} onClick={()=>void read(view.next)}>
    {view.status==='unavailable'?'Retry history': 'Load older entries'}
   </button>}
  </div>
 </details>;
}
