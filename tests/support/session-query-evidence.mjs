import pg from 'pg';
import {localSessionEligibility} from '../../src/security/session-policy.ts';

const owned=Symbol.for('crest.test.session-query-evidence');
// Test-process observation only. Call the real query exactly once and preserve
// its this/arguments, original return object, result and thrown error unchanged.
// Never retain SQL, parameters, credentials, IDs, ciphertext or error messages.
export function observeSessionQueries(Client=pg.Client){
 const original=Client.prototype.query;if(original[owned])throw Error('SESSION_QUERY_OBSERVER_ALREADY_OWNED');
 const events=[];let closed=false,callsObserved=0;
 const record=(kind,at,started,result,error)=>{if(closed)return;try{
  const event={kind,atMs:at,elapsedMs:Math.max(0,Math.round(performance.now()-started))};
  if(error)event.failure={sqlState:typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)?error.code:null};
  else{
   const row=result?.rows?.[0];
   if(kind==='connection_guard')event.allowed=typeof row?.allowed==='boolean'?row.allowed:null;
   else if(kind==='admission')event.admitted=typeof row?.result==='boolean'?row.result:null;
   else if(kind==='bind')event.bound=typeof row?.result?.id==='string';
   else{
    const value=row?.result;event.snapshot=!!value;
    if(value){const decision=localSessionEligibility(value.session,value.actor,value.now,'background');event.localState=decision.state;event.localReason=decision.state==='denied'?decision.reason:null;event.version=typeof value.version==='string'&&/^[0-9]{1,19}$/.test(value.version)?value.version:null;}
   }
  }
  events.push(event);if(events.length>64)events.shift();
 }catch{events.push({kind,atMs:at,projectionUnavailable:true});if(events.length>64)events.shift();}};
 function query(...args){
  const raw=typeof args[0]==='string'?args[0]:args[0]?.text,text=typeof raw==='string'?raw.trim():'';
  const match=/^SELECT crest_commands\.(admit_session_request|app_session_snapshot|bind_browser_session)\(/.exec(text);
  const kind=match?({admit_session_request:'admission',app_session_snapshot:'snapshot',bind_browser_session:'bind'})[match[1]]:text.startsWith('SELECT current_user=$1::name')?'connection_guard':null;
  if(!kind)return Reflect.apply(original,this,args);
  callsObserved++;const at=Date.now(),started=performance.now();
  try{const result=Reflect.apply(original,this,args);if(result&&typeof result.then==='function')void result.then(value=>{record(kind,at,started,value);},error=>{record(kind,at,started,undefined,error);});return result;}
  catch(error){record(kind,at,started,undefined,error);throw error;}
 }
 query[owned]=true;Client.prototype.query=query;
 return Object.freeze({snapshot(){return {scope:'synthetic_query_completion_window_not_request_correlated',causalClaim:false,callsObserved,events:events.map(event=>({...event,...event.failure?{failure:{...event.failure}}:{}}))};},stop(){closed=true;if(Client.prototype.query!==query)throw Error('SESSION_QUERY_OBSERVER_OWNERSHIP_CHANGED');Client.prototype.query=original;}});
}
