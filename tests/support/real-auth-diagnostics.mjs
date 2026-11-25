// Fixed-category, test-only diagnostics. Never return a raw log line, message,
// SQL, parameter, identifier, credential, token or provider response.
export function classifyAuthServiceError(line){
 if(typeof line!=='string'||line.length>65536)return null;
 let row;try{row=JSON.parse(line);}catch{return null;}
 if(!row||typeof row!=='object'||Array.isArray(row)||row.level!=='error')return null;
 const message=[row.error,row.msg,row.message].filter(v=>typeof v==='string').join(' '),state=message.match(/SQLSTATE[ :]+([0-9A-Z]{5})\b/)?.[1]??null;
 const category=/statement timeout|canceling statement due to statement timeout/i.test(message)?'statement_timeout':/deadlock detected/i.test(message)?'deadlock':/could not serialize/i.test(message)?'serialization':/too many clients|remaining connection slots|pool.*(?:exhaust|timeout)/i.test(message)?'connection_capacity':/context deadline exceeded|context canceled|context cancelled/i.test(message)?'context_timeout':/connection.*(?:closed|reset|refused)|broken pipe|unexpected eof/i.test(message)?'connection_failure':/sql: Scan error/i.test(message)?'database_scan':/transaction has already been committed or rolled back/i.test(message)?'transaction_closed':/error finding session/i.test(message)?'session_lookup':/error finding user/i.test(message)?'user_lookup':'provider_error';
 return Object.freeze({category,sqlState:state});
}
export function classifyTestDatabaseError(error){
 if(!error||typeof error!=='object')return null;
 const code=typeof error.code==='string'&&/^[0-9A-Z]{5}$/.test(error.code)?error.code:null,message=typeof error.message==='string'?error.message:'';
 return Object.freeze({category:code==='57014'?'statement_timeout':code==='40P01'?'deadlock':code==='40001'?'serialization':/timeout|timed out/i.test(message)?'query_or_connection_timeout':code?'database_error':'query_error',sqlState:code});
}
export function classifyAuthBridgeError(error){
 return Object.freeze({category:error?.name==='TimeoutError'||error?.name==='AbortError'?'bridge_timeout':'bridge_failure',sqlState:null});
}

const safeProviderCodes=new Set(['invalid_credentials','validation_failed','mfa_verification_failed','mfa_challenge_expired','mfa_ip_address_mismatch','over_request_rate_limit','over_sms_send_rate_limit','bad_jwt','user_banned','session_not_found','refresh_token_not_found','refresh_token_already_used','unexpected_failure']);
export function authBridgeObservation({path,method,status,date,startedAt,finishedAt,body}){
 let route='other';
 try{
  const url=new URL(path,'http://fixture.invalid'),name=url.pathname;
  if(name==='/auth/v1/token')route=url.searchParams.get('grant_type')==='password'?'password':url.searchParams.get('grant_type')==='refresh_token'?'refresh':'token_other';
  else if(name==='/auth/v1/user')route='user';
  else if(name==='/auth/v1/logout')route='logout';
  else if(name==='/auth/v1/.well-known/jwks.json')route='jwks';
  else if(/^\/auth\/v1\/factors\/[a-f0-9-]{36}\/challenge$/.test(name))route='challenge';
  else if(/^\/auth\/v1\/factors\/[a-f0-9-]{36}\/verify$/.test(name))route='verify';
 }catch{/* Unknown paths never cross the diagnostic boundary. */}
 const validTime=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
 const elapsed=validTime(startedAt)&&validTime(finishedAt)?finishedAt-startedAt:null;
 const serverTime=typeof date==='string'?Date.parse(date):NaN;
 const offset=validTime(finishedAt)&&Number.isFinite(serverTime)?serverTime-finishedAt:null;
 let code=null;
 if(Number.isInteger(status)&&status>=400&&status<=599&&body?.length<=1048576){
  try{const value=JSON.parse(body.toString('utf8')),candidate=typeof value?.error_code==='string'?value.error_code:value?.code;code=safeProviderCodes.has(candidate)?candidate:'other_provider_error';}catch{code='unreadable_error';}
 }
 return Object.freeze({route,method:['GET','POST','PUT','DELETE'].includes(method)?method:'other',status:Number.isInteger(status)&&status>=100&&status<=599?status:null,
  startedAt:validTime(startedAt)?startedAt:null,elapsedMs:elapsed!==null&&elapsed>=0&&elapsed<=120000?elapsed:null,
  providerDateOffsetMs:offset!==null&&Math.abs(offset)<=86400000?offset:null,code});
}
