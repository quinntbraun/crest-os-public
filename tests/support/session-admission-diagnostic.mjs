// Failure-only numeric evidence from this disposable fixture. No credential,
// session/actor identifier, provider response or raw database error is returned.
export async function sessionAdmissionDiagnostic(fixture){
 try{
  const result=await fixture.client.query(`SELECT a.bucket,
   count(*) FILTER (WHERE a.admitted_at>clock_timestamp()-interval '1 minute')::int AS recent
   FROM crest_private.session_request_admissions a JOIN crest_private.app_sessions s ON s.id=a.session_id
   WHERE s.actor_id=$1 GROUP BY a.bucket`,[fixture.actor]);
  return {admissions:result.rows.map(row=>({bucket:['ordinary','logout'].includes(row.bucket)?row.bucket:'unknown',recent:Number.isSafeInteger(row.recent)?row.recent:null})),
   requests:fixture.authRequestDiagnostics?.()??[],
   provider:fixture.authDiagnostics().map(row=>({category:typeof row.category==='string'&&/^[a-z_]{1,40}$/.test(row.category)?row.category:'unknown',sqlState:typeof row.sqlState==='string'&&/^[0-9A-Z]{5}$/.test(row.sqlState)?row.sqlState:null}))};
 }catch{return [{unavailable:true}];}
}
