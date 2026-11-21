'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import type {Proof} from '../../client/authentication';

type Kind='Customer'|'Lead'|'Vehicle';
const matchFields={
  phone:{label:'Phone',same:'Same phone'},
  email:{label:'Email',same:'Same email'},
  vin:{label:'VIN',same:'Same VIN'},
  plate:{label:'Plate',same:'Same plate text'},
  description:{label:'Year, make and model',same:'Same year, make and model'},
} as const;
type MatchField=keyof typeof matchFields;
export type MatchRow={id:string;label:string;kind:Kind;matches:Partial<Record<MatchField,boolean>>;detail?:string|undefined};
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

export function LeadMatchNotice({review,fields,canSave,retry,edit,save}:{
  review:Review;fields:readonly MatchField[];canSave:boolean;retry:()=>void;edit:()=>void;save:()=>void;
}){
  const id=useId(),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{if(review.state!=='checking')heading.current?.focus();},[review]);
  if(review.state==='checking')return <p className="field-help" role="status">Checking for possible matches…</p>;

  const matched=review.state==='matches';
  return <section className="lead-match-notice" aria-labelledby={id}>
    <header><h3 id={id} ref={heading} tabIndex={-1}>{matched?'Possible matches':'Matches could not be checked'}</h3>
    <p>{matched?'Compare the fields Crest checked. Choose Edit details to revise the draft.':'Retry the check or save your draft as entered.'}</p></header>
    {matched&&<>
      <ul className="lead-match-candidates">{review.results.rows.map((row,index)=>{
        const firstUnconfirmed=fields.find(field=>!row.matches[field]);
        const evidenceId=(field:MatchField)=>id+'-match-'+index+'-'+field;
        return <li key={row.kind+':'+row.id}>
          <div className="lead-match-record"><strong>{row.label}</strong><span>{row.kind}{row.detail?' · '+row.detail:''}</span></div>
          <table className="lead-match-table" aria-label={'Match evidence for '+row.label}>
            <thead><tr><th scope="col">Field</th><th scope="col">Your draft</th><th scope="col">Saved record</th></tr></thead>
            <tbody>{fields.map(field=><tr key={field} id={evidenceId(field)} tabIndex={-1}>
              <th scope="row">{matchFields[field].label}</th>
              <td>Entered</td>
              <td>{row.matches[field]?<strong className="lead-match-evidence">{matchFields[field].same}</strong>:'Unconfirmed'}</td>
            </tr>)}</tbody>
          </table>
          {firstUnconfirmed&&<button type="button" className="secondary lead-match-jump"
            onClick={()=>document.getElementById(evidenceId(firstUnconfirmed))?.focus()}>Jump to first unconfirmed field</button>}
        </li>;
      })}</ul>
      {review.results.more&&<p className="field-help">Additional matches are available in the directory.</p>}
    </>}
    <div className="lead-match-actions">
      {matched?<button type="button" className="secondary" onClick={edit}>Edit details</button>:<button type="button" className="secondary" onClick={retry} disabled={!canSave}>Retry match check</button>}
      <button type="button" onClick={save} disabled={!canSave}>Save as entered</button>
    </div>
  </section>;
}
