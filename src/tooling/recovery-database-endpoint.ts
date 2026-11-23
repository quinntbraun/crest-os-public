// Compare two owned direct/session connections without retaining credentials.
// Physical host isolation and verified TLS remain operator responsibilities.
import {createHash} from 'node:crypto';
import type pg from 'pg';
export async function recoveryDatabaseEndpoint(client:pg.Client,query:(sql:string)=>Promise<pg.QueryResult>){
 const p=client as unknown as Record<string,unknown>,row=(await query("SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port,extract(epoch FROM pg_postmaster_start_time())::text AS started")).rows[0];
 if(typeof p.host!=='string'||typeof p.port!=='number'||typeof p.database!=='string'||row?.database!==p.database||!(row.address===null||typeof row.address==='string')||!(row.port===null||Number.isInteger(row.port))||typeof row.started!=='string'||!/^\d+(?:\.\d+)?$/.test(row.started))throw Error('RECOVERY_DATABASE_ENDPOINT_REVIEW_REQUIRED');
 return createHash('sha256').update(JSON.stringify([p.host,p.port,p.database,row.address,row.port,row.started])).digest('hex');
}
