// Synthetic failure evidence only: no URL queries, payloads, cookies or identities.
export function workReadDocumentScene({doc=document,path=location.pathname}={}){
 const safeRoute=value=>['/','/schedule','/vehicles','/customers','/sign-in'].includes(value)?value:'other';
 const status=doc.querySelector('.schedule-status'),text=status?.textContent??'',active=doc.activeElement;
 const state=/^Check schedule access/.test(text)?'unverified':/^Saved schedule loaded/.test(text)?'schedule_loaded':/^Saved job loaded/.test(text)?'job_loaded':/^(Loading|Checking)/.test(text)?'loading':/^Sign in/.test(text)?'signed_out':'other';
 return {route:safeRoute(path),readyState:['loading','interactive','complete'].includes(doc.readyState)?doc.readyState:'other',visibility:doc.visibilityState==='hidden'?'hidden':'visible',scheduleRendered:!!status,scheduleState:status?state:null,
  activeTag:['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY','BODY'].includes(active?.tagName)?active.tagName:'other',activeRoute:active?.tagName==='A'?safeRoute(active.pathname):null,
  focusOnScheduleReturn:active?.matches?.('a[href^="/schedule?"]')===true,
  scheduleReturnVisible:[...doc.querySelectorAll('a[href^="/schedule?"]')].some(node=>node.getClientRects().length>0)};
}
export function observeWorkReads(page,fixture,label){
 const responses=[];let phase='initial';
 page.on('response',response=>{
  const route=new URL(response.url()).pathname;
  if(route==='/api/auth/session'||/^\/api\/business\/scheduling\/[a-z-]{1,64}$/.test(route)){
   responses.push({phase,route,status:response.status(),at:Date.now()});if(responses.length>32)responses.shift();
  }
 });
 const report=async()=>{
  const admissions=await fixture.client.query("SELECT bucket,count(*)::int AS total,count(*) FILTER(WHERE admitted_at>clock_timestamp()-interval '1 minute')::int AS recent FROM crest_private.session_request_admissions a JOIN crest_private.app_sessions s ON s.id=a.session_id WHERE s.actor_id=$1 GROUP BY bucket",[fixture.actor]).then(r=>r.rows).catch(()=>null);
  // These accessors already return the fixed-category projections in
  // real-auth-diagnostics.mjs, never raw provider replies or log lines.
  let provider=null,providerRequests=null;
  try{provider=fixture.authDiagnostics().slice(-16);providerRequests=fixture.authRequestDiagnostics().slice(-16);}catch{/* Unavailable diagnostics remain explicit. */}
  let documentScene=null;try{documentScene=await page.evaluate(workReadDocumentScene);}catch{/* No raw document error crosses this boundary. */}
  console.error('SYNTHETIC_WORK_READ_DIAGNOSTIC '+JSON.stringify({label,phase,responses,admissions,provider,providerRequests,documentScene}));
 };
 report.mark=value=>{if(['initial','intake','photo_reopen','preview_clear','scheduled_cancel','release_history','release_save','vehicle_profile_reload','vehicle_return'].includes(value))phase=value;else throw Error('UNKNOWN_SYNTHETIC_PHASE');};
 return report;
}
