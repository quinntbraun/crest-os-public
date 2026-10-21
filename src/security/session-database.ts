import 'server-only';
import pg from 'pg';
export type SessionDatabaseConfiguration={connectionString:string;environment:'production'|'test'};
// Trusted server SQL only. No caller-supplied identifiers or browser exposure.
export function sessionDatabase(config:SessionDatabaseConfiguration){
  let connectionString:string;
  try{
    const url=new URL(config.connectionString);
    if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash
      ||!['production','test'].includes(config.environment)
      ||config.environment==='test'&&(!['127.0.0.1','[::1]'].includes(url.hostname)||!/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)))throw new Error();
    connectionString=url.toString();
  }catch{throw new Error('SESSION_DATABASE_CONFIGURATION_REQUIRED');}
  const ssl=config.environment==='production'?{rejectUnauthorized:true}:false;
  return async(text:string,values:unknown[],signal:AbortSignal):Promise<unknown>=>{
    if(signal.aborted)throw new Error('SESSION_DATABASE_FAILED');
    const client=new pg.Client({connectionString,ssl,connectionTimeoutMillis:1000,statement_timeout:1500,lock_timeout:750,
      query_timeout:2000,options:'-c role=crest_web',application_name:'crest_session_lifecycle'});
    client.on('error',()=>{});
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const timer=setTimeout(()=>controller.abort(),3000);timer.unref();
    const abort=()=>{void client.end().catch(()=>undefined);};combined.addEventListener('abort',abort,{once:true});
    const interrupted=new Promise<never>((_,reject)=>combined.addEventListener('abort',()=>reject(new Error('SESSION_DATABASE_FAILED')),{once:true}));
    try{
      const work=(async()=>{
        await client.connect();if(combined.aborted)throw new Error();
        const guard=await client.query<{allowed:boolean}>(`SELECT current_user='crest_web'
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
            AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
            WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'crest_web') AS allowed`);
        if(guard.rows[0]?.allowed!==true||guard.rows.length!==1||combined.aborted)throw new Error();
        const result=await client.query<{result:unknown}>(text,values);
        if(result.rows.length!==1||!Object.hasOwn(result.rows[0]??{},'result'))throw new Error();
        return result.rows[0]!.result;
      })();
      const result=await Promise.race([work,interrupted]);if(combined.aborted)throw new Error();return result;
    }catch{throw new Error('SESSION_DATABASE_FAILED');}
    finally{clearTimeout(timer);combined.removeEventListener('abort',abort);await client.end().catch(()=>undefined);}
  };
}
