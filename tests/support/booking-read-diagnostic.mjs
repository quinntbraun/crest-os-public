// Failure-only bounded transport metadata. Never retain response bodies or identities.
export function observeBookingReads(page,fixture,label){
 const routes=new Set(['/api/auth/session','/api/business/scheduling/workspace','/api/business/scheduling/original','/api/business/scheduling/book']);
 const responses=[];
 page.on('response',response=>{
  const route=new URL(response.url()).pathname;
  if(routes.has(route)){responses.push({route,status:response.status()});if(responses.length>24)responses.shift();}
 });
 return async()=>{
  const admissions=await fixture.client.query("SELECT bucket,count(*)::int AS total,count(*) FILTER(WHERE admitted_at>clock_timestamp()-interval '1 minute')::int AS recent FROM crest_private.session_request_admissions a JOIN crest_private.app_sessions s ON s.id=a.session_id WHERE s.actor_id=$1 GROUP BY bucket",[fixture.actor]).then(r=>r.rows).catch(()=>[]);
  console.error('SYNTHETIC_BOOKING_READ_DIAGNOSTIC '+JSON.stringify({label,responses,admissions}));
 };
}
