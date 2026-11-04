// Fixed-category, test-only diagnostics. Never return a raw log line, message,
// SQL, parameter, identifier, credential, token or provider response.
export function classifyAuthServiceError(line){
 if(typeof line!=='string'||line.length>65536)return null;
 let row;try{row=JSON.parse(line);}catch{return null;}
 if(!row||typeof row!=='object'||Array.isArray(row)||row.level!=='error')return null;
 const message=[row.error,row.msg,row.message].filter(v=>typeof v==='string').join(' '),state=message.match(/SQLSTATE[ :]+([0-9A-Z]{5})\b/)?.[1]??null;
 const category=/statement timeout|canceling statement due to statement timeout/i.test(message)?'statement_timeout':/deadlock detected/i.test(message)?'deadlock':/could not serialize/i.test(message)?'serialization':/too many clients|remaining connection slots|pool.*(?:exhaust|timeout)/i.test(message)?'connection_capacity':/context deadline exceeded|context canceled|context cancelled/i.test(message)?'context_timeout':/connection.*(?:closed|reset|refused)|broken pipe|unexpected eof/i.test(message)?'connection_failure':'provider_error';
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
