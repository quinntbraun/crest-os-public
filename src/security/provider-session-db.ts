import "server-only";
import pg from "pg";
import type { LiveProviderSessionLookup } from "./provider-auth.ts";

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class ProviderSessionLookupError extends Error {
  constructor() { super("PROVIDER_SESSION_LOOKUP_FAILED");this.name="ProviderSessionLookupError"; }
}
export function createLiveProviderSessionLookup(config:{connectionString:string;environment:"production"|"test"}):LiveProviderSessionLookup {
  let connectionString:string;
  try {
    const url=new URL(config.connectionString);
    if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash
      ||!['production','test'].includes(config.environment)
      ||config.environment==='test'&&(!['127.0.0.1','[::1]'].includes(url.hostname)||!/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname))) throw new Error();
    connectionString=url.toString();
  } catch { throw new Error("PROVIDER_DATABASE_CONFIGURATION_REQUIRED"); }
  const ssl=config.environment==='production'?{rejectUnauthorized:true}:false;
  return async(subject,sessionId,signal)=>{
    if(typeof subject!=='string'||typeof sessionId!=='string'||!uuid.test(subject)||!uuid.test(sessionId)||signal.aborted) throw new ProviderSessionLookupError();
    // A fresh bounded connection avoids borrowing a stale transaction or tenant
    // context. Future pooling must prove equivalent isolation before replacing it.
    const client=new pg.Client({connectionString,ssl,connectionTimeoutMillis:1000,statement_timeout:1500,lock_timeout:750,
      query_timeout:2000,options:'-c role=crest_web',application_name:'crest_provider_session_check'});
    client.on('error',()=>{}); // Never let a transport error escape as an uncaught/logged event.
    const controller=new AbortController();const combined=AbortSignal.any([signal,controller.signal]);
    const timer=setTimeout(()=>controller.abort(),3000);timer.unref();
    const abort=()=>{void client.end().catch(()=>undefined);};combined.addEventListener('abort',abort,{once:true});
    const interrupted=new Promise<never>((_,reject)=>combined.addEventListener('abort',()=>reject(new ProviderSessionLookupError()),{once:true}));
    try {
      const work=(async()=>{
        await client.connect();if(combined.aborted) throw new ProviderSessionLookupError();
        // A runtime login may assume only crest_web; migration/owner credentials
        // must not become a normal auth connection just by setting ROLE.
        const result=await client.query<{live:boolean}>(`SELECT CASE WHEN current_user='crest_web'
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
            AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
            WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'crest_web')
          THEN crest_commands.provider_session_is_live($1::uuid,$2::uuid) ELSE false END AS live`,[subject,sessionId]);
        if(result.rows.length!==1||typeof result.rows[0]?.live!=='boolean') throw new ProviderSessionLookupError();
        return result.rows[0].live;
      })();
      const result=await Promise.race([work,interrupted]);
      if(combined.aborted) throw new ProviderSessionLookupError();return result;
    } catch { throw new ProviderSessionLookupError(); }
    finally {clearTimeout(timer);combined.removeEventListener('abort',abort);await client.end().catch(()=>undefined);}
  };
}
