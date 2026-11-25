import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';

// Passive, failure-only evidence from a disposable synthetic fixture. Never
// retain cookies, hashes, IDs, URLs, request/response bodies or provider tokens.
export function observeQuoteSessionFailures(page,fixture,label){
 if(!/^(chromium|webkit)-(agreement|replacement)$/.test(label))throw Error('FIXED_QUOTE_DIAGNOSTIC_LABEL_REQUIRED');
 const started=new WeakMap(),pending=new Set(),events=[];let phase='setup',closed=false;
 const requestStarted=request=>{if(new URL(request.url()).pathname==='/api/auth/session')started.set(request,Date.now());};
 const observed=response=>{
  if(closed||new URL(response.url()).pathname!=='/api/auth/session'||response.status()!==400)return;
  const request=response.request(),at=Date.now(),eventPhase=phase;
  const work=(async()=>{
   let hash;
   try{
    const headers=await request.allHeaders(),cookies=(headers.cookie??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith('__Host-crest_session='));
    const value=cookies.length===1?cookies[0].slice('__Host-crest_session='.length):'',canonical=/^[-A-Za-z0-9_]{43}$/.test(value)&&Buffer.from(value,'base64url').toString('base64url')===value;
    const site=['same-origin','same-site','cross-site','none'].includes(headers['sec-fetch-site'])?headers['sec-fetch-site']:'unknown';
    let session=null;
    if(canonical){
     hash=createHash('sha256').update(value,'ascii').digest();
     const result=await fixture.client.query({text:`SELECT s.revoked_at IS NOT NULL AS revoked,s.version::text AS version,
      floor(extract(epoch FROM (s.expires_at-clock_timestamp()))*1000)::bigint::text AS "expiresInMs",
      (SELECT count(*)::int FROM crest_private.session_request_admissions a WHERE a.session_id=s.id AND a.bucket='ordinary'
       AND a.admitted_at>clock_timestamp()-interval '1 minute') AS "recentOrdinary"
      FROM crest_private.app_sessions s WHERE s.token_hash=$1 AND s.actor_id=$2`,values:[hash,fixture.actor],query_timeout:2000});
     const row=result.rows[0];session=row?{matched:true,revoked:row.revoked,version:/^[0-9]+$/.test(row.version)?row.version:null,expiresInMs:/^-?[0-9]+$/.test(row.expiresInMs)?row.expiresInMs:null,recentOrdinary:Number.isSafeInteger(row.recentOrdinary)?row.recentOrdinary:null}:{matched:false};
    }
    events.push({phase:eventPhase,status:400,atMs:at,elapsedMs:started.has(request)?at-started.get(request):null,originMatches:headers.origin===fixture.origin,site,cookieCount:cookies.length,canonicalCookie:canonical,session,sampleDelayMs:Date.now()-at});
   }catch{events.push({phase:eventPhase,status:400,unavailable:true,sampleDelayMs:Date.now()-at});}
   finally{hash?.fill(0);if(events.length>8)events.splice(0,events.length-8);}
  })();pending.add(work);void work.finally(()=>pending.delete(work));
 };
 page.on('request',requestStarted);page.on('response',observed);
 return {mark(label){phase=label.startsWith('actual sharing')?'sharing':label.startsWith('actual confirmation')?'acceptance':label.startsWith('paused and failed')?'recovery':label.startsWith('four-width')?'layout':label.startsWith('replacement editing')?'replacement':'setup';},async finish(){closed=true;page.off('request',requestStarted);page.off('response',observed);await Promise.allSettled([...pending]);await mkdir('.local/review',{recursive:true});await writeFile('.local/review/quote-session-failures-'+label+'.json',JSON.stringify({scope:'synthetic_failure_time_post_response_sample_only',causalClaim:false,events},null,2)+'\n');}};
}
