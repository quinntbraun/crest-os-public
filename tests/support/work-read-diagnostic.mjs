// Synthetic failure evidence only: no URL queries, payloads, cookies or identities.
export function observeWorkReads(page,fixture,label){
 const responses=[];let phase='initial';
 page.on('response',response=>{
  const route=new URL(response.url()).pathname;
  if(route==='/api/auth/session'||/^\/api\/business\/scheduling\/[a-z-]{1,64}$/.test(route)){
   responses.push({phase,route,status:response.status()});if(responses.length>32)responses.shift();
  }
 });
 const report=async()=>{
  const admissions=await fixture.client.query("SELECT bucket,count(*)::int AS total,count(*) FILTER(WHERE admitted_at>clock_timestamp()-interval '1 minute')::int AS recent FROM crest_private.session_request_admissions a JOIN crest_private.app_sessions s ON s.id=a.session_id WHERE s.actor_id=$1 GROUP BY bucket",[fixture.actor]).then(r=>r.rows).catch(()=>null);
  // These accessors already return the fixed-category projections in
  // real-auth-diagnostics.mjs, never raw provider replies or log lines.
  let provider=null,providerRequests=null;
  try{provider=fixture.authDiagnostics().slice(-16);providerRequests=fixture.authRequestDiagnostics().slice(-16);}catch{/* Unavailable diagnostics remain explicit. */}
  console.error('SYNTHETIC_WORK_READ_DIAGNOSTIC '+JSON.stringify({label,phase,responses,admissions,provider,providerRequests}));
 };
 report.mark=value=>{if(['initial','intake','photo_reopen','preview_clear','scheduled_cancel','release_history','release_save'].includes(value))phase=value;else throw Error('UNKNOWN_SYNTHETIC_PHASE');};
 return report;
}
