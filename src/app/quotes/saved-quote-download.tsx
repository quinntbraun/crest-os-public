'use client';
import {useLayoutEffect,useRef,useState} from 'react';
import {authentication} from '../../client/authentication';
import {quotes} from '../../client/quotes';
import type {StoredQuoteFamily,StoredQuoteRevision} from '../../commercial/quote-storage-contract';
type Row=Readonly<{family:StoredQuoteFamily;revision:StoredQuoteRevision}>;
type Selection=Readonly<{businessId:string;familyId:string;revisionId:string;familyVersion:string;revisionVersion:string;contentVersion:string;contentHash:string;state:StoredQuoteRevision['state']}>;
type View=Readonly<{busy:boolean;message:string}>;
type Dependencies={change:(value:View)=>void;session?:typeof authentication.session;context?:typeof quotes.context;history?:typeof quotes.history;requestSave?:(bytes:Uint8Array<ArrayBuffer>,filename:string)=>()=>void};
const selection=(row:Row):Selection=>Object.freeze({businessId:row.family.business_id,familyId:row.family.id,revisionId:row.revision.id,familyVersion:row.family.version,revisionVersion:row.revision.version,contentVersion:row.revision.content_version,contentHash:row.revision.content_hash,state:row.revision.state});
const same=(a:Selection|null,b:Selection)=>a!==null&&(Object.keys(b) as (keyof Selection)[]).every(key=>a[key]===b[key]);
function browserSave(bytes:Uint8Array<ArrayBuffer>,filename:string){
 const link=document.createElement('a'),url=URL.createObjectURL(new Blob([bytes],{type:'application/json;charset=utf-8'}));
 try{link.href=url;link.download=filename;document.body.append(link);link.click();return ()=>URL.revokeObjectURL(url);}
 catch{URL.revokeObjectURL(url);throw Error();}finally{link.remove();}
}
/** One explicit private record download. Only selection IDs/versions are
 * retained; mutable encoded bytes are cleared, owned URLs are released.
 * JavaScript strings are not zeroizable. */
export function createQuoteRecordDownloadController(deps:Dependencies){
 const session=deps.session??authentication.session,context=deps.context??quotes.context,history=deps.history??quotes.history,requestSave=deps.requestSave??browserSave;
 let alive=true,active:AbortController|null=null,current:Selection|null=null,disabled=true,message='',revoke:(()=>void)|null=null,timer:ReturnType<typeof setTimeout>|null=null;
 const emit=()=>{if(alive)deps.change(Object.freeze({busy:active!==null,message}));};
 function release(){if(timer!==null)clearTimeout(timer);timer=null;const previous=revoke;revoke=null;previous?.();}
 function cancel(){active?.abort();active=null;release();message='Download canceled because the quote, access state or page changed. Request it again after reviewing the saved quote.';emit();}
 function update(row:Row,blocked:boolean){if(!alive)return;const next=selection(row),changed=!same(current,next);if(active&&(changed||blocked)||revoke&&(changed||blocked))cancel();current=next;disabled=blocked;}
 function clearPrivate(){if(!alive)return;cancel();current=null;disabled=true;}
 const page=typeof document==='undefined'?null:document,windowEvents=typeof window==='undefined'?null:window,hide=()=>{if(page?.visibilityState==='hidden')clearPrivate();};
 page?.addEventListener('visibilitychange',hide);windowEvents?.addEventListener('pagehide',clearPrivate);
 const live=(request:AbortController,pinned:Selection)=>{if(!alive||active!==request||request.signal.aborted||disabled||!same(current,pinned))throw Error();};
 async function download(row:Row,blocked:boolean){
  if(!alive||active)return;update(row,blocked);if(disabled||current===null)return;const pinned=current,c=new AbortController();active=c;message='Checking current quote access…';emit();let bytes:Uint8Array<ArrayBuffer>|null=null,attempted=false;
  try{
   const proof=await session(c.signal);live(c,pinned);const before=await context(proof,c.signal);live(c,pinned);if(before.context.businessId!==pinned.businessId)throw Error();
   const result=await history(pinned.businessId,{familyId:pinned.familyId,revisionId:pinned.revisionId,afterVersion:'0',pageSize:5},proof,c.signal);live(c,pinned);
   // Historical Sent/Accepted rows remain retrievable even when the family's
   // current pointer names another Draft; its current version must match.
   if('state'in result||result.family.business_id!==pinned.businessId||result.family.id!==pinned.familyId||result.family.version!==pinned.familyVersion||result.revision.business_id!==pinned.businessId||result.revision.family_id!==pinned.familyId||result.revision.id!==pinned.revisionId||result.revision.version!==pinned.revisionVersion||result.revision.content_version!==pinned.contentVersion||result.revision.content_hash!==pinned.contentHash||result.revision.state!==pinned.state)throw Error();
   const latest=await session(c.signal);live(c,pinned);const after=await context(latest,c.signal);live(c,pinned);
   if(before.binding!==after.binding||after.context.businessId!==pinned.businessId||before.context.recoveryEpoch!==after.context.recoveryEpoch||before.context.writeState!==after.context.writeState)throw Error();
   const draft=pinned.state==='Draft'||pinned.state==='Ready for Review';
   bytes=new TextEncoder().encode(JSON.stringify({schemaVersion:1,scope:draft?'saved_quote_draft_and_first_history_page':'saved_quote_revision_and_first_history_page',privateInternalDataIncluded:true,completeCrestExport:false,completeBackup:false,unsavedDraftIncluded:false,historyHasMore:result.hasMore,family:result.family,revision:result.revision,items:result.items,history:result.history},null,2)+'\n');
   if(bytes.byteLength>8388608)throw Error();live(c,pinned);attempted=true;const candidate=requestSave(bytes,draft?'crest-private-quote-draft.json':'crest-private-quote-revision.json');try{live(c,pinned);}catch{candidate();throw Error();}revoke=candidate;timer=setTimeout(()=>{timer=null;const previous=revoke;revoke=null;previous?.();},1000);message='Download requested. Check your browser’s downloads to confirm the file.';
  }catch{if(alive&&active===c&&!c.signal.aborted)message=attempted?'The download could not be confirmed. Check your browser’s downloads before trying again.':'Access or the current version could not be confirmed. Reload saved quotes before requesting a file. No file was requested.';}
  finally{bytes?.fill(0);if(active===c){active=null;emit();}}
 }
 return Object.freeze({download,update,clearPrivate,dispose(){if(!alive)return;alive=false;active?.abort();active=null;current=null;disabled=true;release();page?.removeEventListener('visibilitychange',hide);windowEvents?.removeEventListener('pagehide',clearPrivate);}});
}

// Explicit private record retrieval through genuine current authorization.
// The customer document is separate; this file includes internal retained data.
export function QuoteRecordDownload({row,disabled}:{row:Row;disabled:boolean}){
 const [view,setView]=useState<View>({busy:false,message:''}),current=useRef<ReturnType<typeof createQuoteRecordDownloadController>|null>(null);
 useLayoutEffect(()=>{
  const controller=createQuoteRecordDownloadController({change:setView});current.current=controller;
  return ()=>{current.current=null;controller.dispose();};
 },[]);
 useLayoutEffect(()=>{current.current?.update(row,disabled);},[row,disabled]);
 return <div className="record-download"><button type="button" className="secondary" disabled={disabled||view.busy} onClick={()=>void current.current?.download(row,disabled)}>{row.revision.state==='Draft'||row.revision.state==='Ready for Review'?'Download saved draft (private JSON)':'Download saved quote (private JSON)'}</button><p className="field-help">Includes internal notes, saved source records and the first five history entries. Keep this file private. Unsaved edits are excluded; the file states whether more history exists. This is not a complete business export or backup.</p>{view.message&&<p role="status" aria-label="Quote download status">{view.message}</p>}</div>;
}
