import 'server-only';
import pg from 'pg';
export type SessionDatabaseConfiguration={connectionString:string;environment:'production'|'test'};
type Query=(text:string,values:unknown[])=>Promise<unknown>;
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
  async function connection<T>(signal:AbortSignal,transaction:boolean,work:(query:Query,signal:AbortSignal)=>Promise<T>,command=false):Promise<T>{
    let convertedCustomerError:unknown,rollbackConfirmed=false;
    if(signal.aborted)throw new Error('SESSION_DATABASE_FAILED');
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const client=new pg.Client({connectionString,ssl,connectionTimeoutMillis:1000,statement_timeout:command?10000:transaction?11000:1500,lock_timeout:command?3000:transaction?10000:750,
      query_timeout:command?11000:transaction?12000:2000,options:'-c role=crest_web',application_name:command?'crest_business_command':transaction?'crest_session_refresh':'crest_session_lifecycle'});
    client.on('error',()=>controller.abort());client.once('end',()=>controller.abort());
    const timer=setTimeout(()=>controller.abort(),transaction?15000:3000);timer.unref();
    const abort=()=>{void client.end().catch(()=>undefined);};combined.addEventListener('abort',abort,{once:true});
    const interrupted=new Promise<never>((_,reject)=>combined.addEventListener('abort',()=>reject(new Error('SESSION_DATABASE_FAILED')),{once:true}));
    try{
      const pending=(async()=>{
        await client.connect();if(combined.aborted)throw new Error();
        const guard=await client.query<{allowed:boolean}>(`SELECT current_user='crest_web'
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
            AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
            WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>'crest_web') AS allowed`);
        if(guard.rows[0]?.allowed!==true||guard.rows.length!==1||combined.aborted)throw new Error();
        const query:Query=async(text,values)=>{
          if(combined.aborted)throw new Error();
          let result;
          try{result=await client.query<{result:unknown}>(text,values);}catch(error){
            // Only a failed, fixed lead-save statement can produce this known
            // conflict. Confirmation is withheld until ROLLBACK is acknowledged.
            if(command&&text==='SELECT crest_commands.save_lead($1::bytea,$2::uuid,$3::uuid,$4::text,$5::uuid,$6::uuid,$7::timestamptz,$8::uuid,$9::uuid,$10::uuid,$11::integer,$12::uuid,$13::bigint,$14::jsonb) AS result'
              &&error instanceof Error&&'code' in error&&error.code==='55000'&&error.message==='CREST_CONVERTED_CUSTOMER_IMMUTABLE')convertedCustomerError=error;
            throw error;
          }
          if(result.rows.length!==1||!Object.hasOwn(result.rows[0]??{},'result'))throw new Error();
          return result.rows[0]!.result;
        };
        if(!transaction)return work(query,combined);
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        try{
          await client.query("SET LOCAL idle_in_transaction_session_timeout='12s'; SET LOCAL transaction_timeout='15s'");
          const result=await work(query,combined);if(combined.aborted)throw new Error();
          const completion=await client.query('COMMIT');
          // PostgreSQL answers ROLLBACK if a callback swallowed a statement
          // error and left the transaction aborted. Never confirm that result.
          if(completion.command!=='COMMIT')throw new Error('SESSION_DATABASE_FAILED');
          return result;
        }catch(error){if(!combined.aborted)await client.query('ROLLBACK').then(r=>{rollbackConfirmed=r.command==='ROLLBACK';},()=>undefined);throw error;}
      })();
      const result=await Promise.race([pending,interrupted]);if(combined.aborted)throw new Error();return result;
    }catch(error){
      // eslint-disable-next-line preserve-caught-error -- Only a fixed marker crosses after an acknowledged rollback; raw database details stay private.
      if(command&&!combined.aborted&&rollbackConfirmed&&convertedCustomerError!==undefined&&error===convertedCustomerError)throw new Error('LEAD_CONVERTED_CUSTOMER_IMMUTABLE');
      // Only this fixed, expected business-fence result may cross the command
      // profile. No SQL/SDK cause, detail, hint, parameter or raw message escapes.
      // eslint-disable-next-line preserve-caught-error -- Database causes may contain credentials, SQL text or parameters.
      if(command&&error instanceof Error&&'code' in error&&error.code==='P0001'&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new Error('RECOVERY_REVIEW_REQUIRED');
      // eslint-disable-next-line preserve-caught-error -- Never transport a raw database cause outside this boundary.
      throw new Error('SESSION_DATABASE_FAILED');
    }
    finally{clearTimeout(timer);combined.removeEventListener('abort',abort);await client.end().catch(()=>undefined);}
  }
  const query=async(text:string,values:unknown[],signal:AbortSignal)=>connection(signal,false,current=>current(text,values));
  return Object.assign(query,{transaction:<T>(work:(query:Query,signal:AbortSignal)=>Promise<T>,signal:AbortSignal)=>connection(signal,true,work),
    commandTransaction:<T>(work:(query:Query,signal:AbortSignal)=>Promise<T>,signal:AbortSignal)=>connection(signal,true,work,true)});
}
