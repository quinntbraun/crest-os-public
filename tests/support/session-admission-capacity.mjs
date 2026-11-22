import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

// Extra state inspections consume real session admissions. Wait for their
// actual rolling-window expiry before the original financial phase. No session
// row is changed, no request is retried, and the parent test deadline is intact.
export async function waitForSessionAdmissionCapacity(fixture,{reserve=90}={}){
 assert(Number.isSafeInteger(reserve)&&reserve>=1&&reserve<=120);
 const start=Date.now(),maximumRecent=120-reserve;
 for(;;){
  const result=await fixture.client.query(`SELECT
   GREATEST(0,ceil(extract(epoch FROM (a.admitted_at+interval '1 minute'-clock_timestamp()))*1000))::int AS wait_ms
   FROM crest_private.session_request_admissions a
   JOIN crest_private.app_sessions s ON s.id=a.session_id
   WHERE s.actor_id=$1 AND a.bucket='ordinary'
     AND a.admitted_at>clock_timestamp()-interval '1 minute'
   ORDER BY a.admitted_at`,[fixture.actor]);
  if(result.rows.length<=maximumRecent)return;
  const waitMs=result.rows[result.rows.length-maximumRecent-1]?.wait_ms;
  assert(Number.isSafeInteger(waitMs)&&waitMs>=0&&waitMs<=60000);
  assert(Date.now()-start+waitMs<=65000,'Existing session admission window must expire without changing its policy');
  await delay(Math.max(25,Math.min(60000,waitMs+25)));
 }
}
