'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import type {Proof} from '../../client/authentication';

type Kind='Customer'|'Lead'|'Vehicle';
export type MatchRow={id:string;label:string;kind:Kind;reasons:string[];detail?:string|undefined};
export type MatchResults={rows:MatchRow[];more:boolean};
type Review={draft:object;state:'checking'|'failed'}|{draft:object;state:'matches';results:MatchResults};
type Attempt={
  lookup:((proof:Proof,signal:AbortSignal)=>Promise<MatchResults>)|null;
  stillCurrent:()=>boolean;
  save:()=>void;
};

export function useLeadMatchReview(draft:object|null){
  const [review,setReview]=useState<Review|null>(null);
  const pending=useRef<AbortController|null>(null);

  useEffect(()=>{
    function stop(){pending.current?.abort();pending.current=null;}
    function hide(){if(document.visibilityState==='hidden'){stop();setReview(null);}}
    function leave(){stop();setReview(null);}
    document.addEventListener('visibilitychange',hide);
    window.addEventListener('pagehide',leave);
    return ()=>{
      stop();
      document.removeEventListener('visibilitychange',hide);
      window.removeEventListener('pagehide',leave);
    };
  },[draft]);

  const active=review?.draft===draft?review:null;
  async function run({lookup,stillCurrent,save}:Attempt){
    if(!draft||pending.current||!stillCurrent())return;
    if(!lookup){setReview(null);save();return;}
    const request=new AbortController();
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(8000)]);
    pending.current=request;
    setReview({draft,state:'checking'});
    try{
      const proof=await authentication.session(signal);
      const results=await lookup(proof,signal);
      signal.throwIfAborted();
      if(!stillCurrent())return;
      if(results.rows.length){setReview({draft,state:'matches',results});return;}
      setReview(null);
      save();
    }catch{
      if(!request.signal.aborted&&stillCurrent())setReview({draft,state:'failed'});
    }finally{
      if(pending.current===request)pending.current=null;
    }
  }
  return {active,run,dismiss:()=>setReview(null)};
}

export function LeadMatchNotice({review,canSave,retry,edit,save}:{review:Review;canSave:boolean;retry:()=>void;edit:()=>void;save:()=>void}){
  const id=useId(),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(review.state!=='checking')heading.current?.focus();},[review]);
  if(review.state==='checking')return <p className="field-help" role="status">Checking for possible matches…</p>;

  const matched=review.state==='matches';
  return <section className="lead-match-notice" aria-labelledby={id}>
    <header><h3 id={id} ref={heading} tabIndex={-1}>{matched?'Possible matches':'Matches could not be checked'}</h3>
    <p>{matched?'Review the matching details below. You can edit this draft or save it as entered.':'Retry the check or save your draft as entered.'}</p></header>
    {matched&&<>
      <ul>{review.results.rows.map(row=><li key={row.kind+':'+row.id}>
        <div><strong>{row.label}</strong><span>{row.kind}{row.detail?' · '+row.detail:''}</span></div>
        <span className="lead-match-evidence">{row.reasons.join(' · ')}</span>
      </li>)}</ul>
      {review.results.more&&<p className="field-help">Additional matches are available in the directory.</p>}
    </>}
    <div className="lead-match-actions">
      {matched?<button type="button" className="secondary" onClick={edit}>Edit details</button>:<button type="button" className="secondary" onClick={retry} disabled={!canSave}>Retry match check</button>}
      <button type="button" onClick={save} disabled={!canSave}>Save as entered</button>
    </div>
  </section>;
}
