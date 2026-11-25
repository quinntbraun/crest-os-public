// Test-only fixed categories. Never retain raw replies, SQL text, credentials,
// references, request bodies, reasons or arbitrary provider fields.
import {classifyTestDatabaseError} from './real-auth-diagnostics.mjs';
const codes=new Set(['success','other','SCHEDULING_SAVE_NOT_SUBMITTED','SCHEDULING_SAVE_OUTCOME_UNKNOWN','SCHEDULING_REQUEST_FAILED','RECOVERY_REVIEW_REQUIRED']);
const safeReply=value=>value?{status:Number.isInteger(value.status)&&value.status>=100&&value.status<=599?value.status:null,code:codes.has(value.code)?value.code:'other'}:null;
export async function workTimeReplyDiagnostic(response){
 const status=response.status();if(status===200)return {status,code:'success'};
 const value=await response.json().catch(()=>null);
 return safeReply({status,code:value&&typeof value==='object'?value.error:null});
}
export async function workTimeFailureDiagnostic(fixture,engine,reply){
 const categories=new Set(['statement_timeout','deadlock','serialization','connection_capacity','context_timeout','connection_failure','provider_error','query_or_connection_timeout','database_error','query_error','bridge_timeout','bridge_failure','capture_unavailable']);
 let provider,database;
 try{provider=fixture.authDiagnostics().slice(0,64).map(row=>({category:categories.has(row.category)?row.category:'other',sqlState:typeof row.sqlState==='string'&&/^[0-9A-Z]{5}$/.test(row.sqlState)?row.sqlState:null}));}catch{provider=[{category:'capture_unavailable',sqlState:null}];}
 try{
  const result=await fixture.client.query({text:'SELECT state,wait_event_type,count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() GROUP BY state,wait_event_type',query_timeout:1000});
  const states=new Set(['active','idle','idle in transaction','idle in transaction (aborted)']),waits=new Set(['Activity','BufferPin','Client','Extension','IO','IPC','Lock','LWLock','Timeout']);
  database=result.rows.slice(0,32).map(row=>({state:states.has(row.state)?row.state:'other',wait:row.wait_event_type===null?null:waits.has(row.wait_event_type)?row.wait_event_type:'other',count:Number.isSafeInteger(row.count)&&row.count>=0?row.count:null}));
 }catch(error){database=classifyTestDatabaseError(error);}
 console.error('WORK_TIME_FAILURE_DIAGNOSTIC '+JSON.stringify({engine:['chromium','webkit'].includes(engine)?engine:'other',reply:safeReply(reply),provider,database}));
}
