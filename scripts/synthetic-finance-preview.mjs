// Read-only startup check for the separately provisioned fictional finance login.
import assert from 'node:assert/strict';
import {lstat,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';

const failure='SYNTHETIC_FINANCE_PREVIEW_REVIEW_REQUIRED';

export async function requireSyntheticFinancePreviewConnection(connectionString,login){
 const client=new pg.Client({connectionString,connectionTimeoutMillis:5000,statement_timeout:5000,options:'-c role=crest_finance_preview'});
 try{
  await client.connect();
  const {rows}=await client.query(`
   SELECT session_user=$1::name AND current_user='crest_finance_preview'
    AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
      AND NOT (r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls))
    AND NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
     WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
      AND (r.rolname<>'crest_finance_preview' OR m.admin_option)
    ) AS allowed`,[login]);
  assert.equal(rows[0]?.allowed,true,failure);
 }catch{throw Error(failure);}
 finally{await client.end().catch(()=>undefined);}
}

export async function readSyntheticFinancePreview(directory,state,taxProfiles=false,categoryMappings=false,moneyChannels=false,invoicePreparation=false){
 assert.equal(typeof invoicePreparation,'boolean',failure);
 assert.equal(typeof taxProfiles,'boolean',failure);assert.equal(typeof categoryMappings,'boolean',failure);
 assert.equal(typeof moneyChannels,'boolean',failure);
 let connectionString,login;
 try{
  assert(typeof state.id==='string'&&/^[a-f0-9]{16}$/.test(state.id)&&state.databaseName==='crest_migrate_'+state.id);
  assert(typeof state.businessId==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(state.businessId));
  const path=join(directory,'finance-preview.json'),metadata=await lstat(path);
  assert(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.size>0&&metadata.size<=512);
  const value=JSON.parse(await readFile(path,'utf8'));
  assert.deepEqual(Object.keys(value).sort(),['businessId','formatVersion','password','workspaceId']);
  assert(value.formatVersion===1&&value.workspaceId===state.id&&value.businessId===state.businessId
   &&typeof value.password==='string'&&/^[a-f0-9]{64}$/.test(value.password));
  login='crest_finance_local_'+state.id;
  connectionString=`postgresql://${login}:${value.password}@127.0.0.1:54329/${state.databaseName}`;
 }catch{throw Error(failure);}
 await requireSyntheticFinancePreviewConnection(connectionString,login);
 return {connectionString,fixedMappings:true,taxProfiles,categoryMappings,moneyChannels,invoicePreparation};
}
