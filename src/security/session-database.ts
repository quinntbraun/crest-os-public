import 'server-only';
import {productionCapability} from './production-capabilities.ts';
import type {ProductionCapabilityConfiguration} from './production-capabilities.ts';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {supplierPayableReviewRefusals as supplierPayableReadRefusals} from '../bookkeeping/expenses/supplier-payable-review-contract.ts';
export type SessionDatabaseConfiguration={connectionString:string;environment:'production'|'test'};
type Query=(text:string,values:unknown[])=>Promise<unknown>;
type ConnectionProfile='read'|'admission'|'refresh'|'command'|'contact-import';
// Trusted server SQL only. No caller-supplied identifiers or browser exposure.
export function sessionDatabase(config:SessionDatabaseConfiguration){return databaseForRole(config,'crest_web');}
export function custodyPhotoDispatcherDatabase(config:SessionDatabaseConfiguration&ProductionCapabilityConfiguration){
  if(config.environment==='production'&&!productionCapability(config,'dropoffPhotos'))throw new Error('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  return databaseForRole(config,'crest_custody_photo_dispatch');
}
export function supplierDocumentWorkerDatabase(config:SessionDatabaseConfiguration&ProductionCapabilityConfiguration){
  if(config.environment==='production'&&!productionCapability(config,'supplierOriginals'))throw new Error('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  return databaseForRole(config,'crest_supplier_bill_document_worker');
}
export function financePreviewDatabase(config:SessionDatabaseConfiguration){
  if(config.environment!=='test')throw new Error('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  return databaseForRole(config,'crest_finance_preview');
}
export function productionFinanceDatabase(config:SessionDatabaseConfiguration&ProductionCapabilityConfiguration){
  if(!productionCapability(config,'finance'))throw new Error('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  // Retain the existing closed command role and its historical name. No new
  // grants, direct table access, fixture controls or business data are created.
  return databaseForRole(config,'crest_finance_preview');
}
export function createLegacyContactImportDispatcher(config:SessionDatabaseConfiguration){
  if(config.environment!=='test')throw new Error('SESSION_DATABASE_CONFIGURATION_REQUIRED');
  const database=databaseForRole(config,'crest_legacy_contact_dispatch');
  return async(signal:AbortSignal)=>{
    signal.throwIfAborted();
    const lease=randomUUID();
    try{
      const claim=await database.commandTransaction(query=>
        query('SELECT crest_commands.claim_legacy_contact_application($1::uuid) AS result',[lease]),signal);
      if(claim==='idle'||claim==='retired')return claim==='retired';
      if(claim!=='claimed')throw new Error('SESSION_DATABASE_FAILED');
      return await database.commandTransaction(async query=>{
        const result=await query('SELECT crest_commands.run_claimed_legacy_contact_application($1::uuid) AS result',[lease]);
        if(typeof result!=='boolean')throw new Error('SESSION_DATABASE_FAILED');
        return result;
      },signal);
    }catch(error){
      // A firm or uncertain failure may leave this attempt leased. Cleanup
      // can only release this UUID, and a completed import is already closed.
      await database.commandTransaction(query=>
        query('SELECT crest_commands.release_legacy_contact_application($1::uuid) AS result',[lease]),
        AbortSignal.timeout(5000)).catch(()=>undefined);
      throw error;
    }
  };
}
function databaseForRole(config:SessionDatabaseConfiguration,role:'crest_web'|'crest_custody_photo_dispatch'|'crest_finance_preview'|'crest_supplier_bill_document_worker'|'crest_legacy_contact_dispatch'){
  let connectionString:string;
  try{
    const url=new URL(config.connectionString);
    if(!['postgres:','postgresql:'].includes(url.protocol)||!url.username||!url.password||!url.pathname.slice(1)||url.search||url.hash
      ||!['production','test'].includes(config.environment)
      ||config.environment==='test'&&(!['127.0.0.1','[::1]'].includes(url.hostname)||!/^\/crest_migrate_[a-f0-9]{16}$/.test(url.pathname)))throw new Error();
    connectionString=url.toString();
  }catch{throw new Error('SESSION_DATABASE_CONFIGURATION_REQUIRED');}
  const ssl=config.environment==='production'?{rejectUnauthorized:true}:false;
  async function connection<T>(signal:AbortSignal,profile:ConnectionProfile,work:(query:Query,signal:AbortSignal)=>Promise<T>):Promise<T>{
    let convertedCustomerError:unknown,rollbackConfirmed=false;
    if(signal.aborted)throw new Error('SESSION_DATABASE_FAILED');
    const transaction=profile!=='read',command=profile==='command',refresh=profile==='refresh',importWorker=profile==='contact-import';
    const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal]);
    const client=new pg.Client({connectionString,ssl,connectionTimeoutMillis:1000,statement_timeout:importWorker?240000:command?10000:refresh?11000:1500,lock_timeout:command||importWorker?3000:refresh?10000:750,
      query_timeout:importWorker?245000:command?11000:refresh?12000:2000,options:'-c role='+role,
      application_name:importWorker?role:command?'crest_business_command':refresh?'crest_session_refresh':'crest_session_lifecycle'});
    client.on('error',()=>controller.abort());client.once('end',()=>controller.abort());
    const timer=setTimeout(()=>controller.abort(),importWorker?275000:command||refresh?15000:3000);timer.unref();
    const abort=()=>{void client.end().catch(()=>undefined);};combined.addEventListener('abort',abort,{once:true});
    const interrupted=new Promise<never>((_,reject)=>combined.addEventListener('abort',()=>reject(new Error('SESSION_DATABASE_FAILED')),{once:true}));
    try{
      const pending=(async()=>{
        await client.connect();if(combined.aborted)throw new Error();
        const guard=await client.query<{allowed:boolean}>(`SELECT current_user=$1::name
          AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=session_user AND r.rolcanlogin
            AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit))
          AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m JOIN pg_catalog.pg_roles r ON r.oid=m.roleid
            WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user) AND r.rolname<>$1::name)
          ${importWorker||config.environment==='production'&&['crest_finance_preview','crest_custody_photo_dispatch','crest_supplier_bill_document_worker'].includes(role)?`AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname=$1::name
            AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolinherit)
            AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
            AND EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members m
              WHERE m.member=(SELECT oid FROM pg_catalog.pg_roles WHERE rolname=session_user)
                AND m.roleid=r.oid AND m.set_option AND NOT (m.inherit_option OR m.admin_option)))`:''}
          AS allowed`,[role]);
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
          await client.query(importWorker?
            "SET LOCAL idle_in_transaction_session_timeout='12s'; SET LOCAL transaction_timeout='270s'":profile==='admission'?
            "SET LOCAL idle_in_transaction_session_timeout='3s'; SET LOCAL transaction_timeout='3s'":
            "SET LOCAL idle_in_transaction_session_timeout='12s'; SET LOCAL transaction_timeout='15s'");
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
      if(role==='crest_finance_preview'&&command&&!combined.aborted&&rollbackConfirmed&&error instanceof Error&&'code' in error){
        // eslint-disable-next-line preserve-caught-error -- Only a proven rollback and an exact authority marker cross this boundary.
        if(error.code==='42501'&&error.message==='CREST_MUTATION_AUTHORIZATION_DENIED')throw new Error('FINANCE_ACCOUNT_SIGN_IN_REQUIRED');
        // eslint-disable-next-line preserve-caught-error -- This exact setup marker contains no database detail.
        if(error.code==='P0001'&&error.message==='FINANCE_ACCOUNT_SETUP_REQUIRED')throw new Error('FINANCE_ACCOUNT_SETUP_REQUIRED');
        if(error.code==='40001'&&['FINANCE_MAPPING_VERSION_CONFLICT','FINANCE_TAX_VERSION_CONFLICT','FINANCE_CHANNEL_VERSION_CONFLICT',
         'OPENING_WORKSHEET_REVISION_CONFLICT','OPENING_AR_REVISION_CONFLICT','OPENING_FUNDS_REVISION_CONFLICT','SUPPLIER_PAYABLE_CURRENT_DRAFT_REQUIRED',
         'SUPPLIER_PAYABLE_REVIEW_CHANGED','SUPPLIER_PAYABLE_DUPLICATE_REVIEW_REQUIRED','SUPPLIER_SETTLEMENT_REMAINING_CHANGED'].includes(error.message)){
          // eslint-disable-next-line preserve-caught-error -- The transaction rolled back and the marker is allowlisted.
          throw new Error(error.message);
        }
        if(error.code==='23514'&&['FINANCE_CHANNEL_ACCOUNT_PINNED','INVOICE_DRAFT_JOB_REQUIRED',
         'INVOICE_DRAFT_COMPLETED_SCOPE_REQUIRED','DIRECT_RECEIPT_TIP_BASIS_REQUIRED','DIRECT_RECEIPT_TIP_AMOUNT_REQUIRED',
         'REFUND_TRANSFER_FEE_AMOUNT_REQUIRED','REFUND_TRANSFER_FEE_MAPPING_REQUIRED','COLLECTION_RECREDIT_AMOUNT_REQUIRED',
         'COLLECTION_RECREDIT_FAILURE_REQUIRED','COLLECTION_RECREDIT_DATE_REQUIRED','COLLECTION_RECREDIT_RANGE_UNAVAILABLE',
         'COLLECTION_RECREDIT_RECEIVABLE_REQUIRED',
         'COLLECTION_RECREDIT_VERIFIED_CHANNEL_REQUIRED','COLLECTION_RECREDIT_FUNDS_MAPPING_REQUIRED',
         'OPENING_RECEIVABLES_CUSTOMER_REQUIRED','OPENING_AR_BALANCE_REQUIRED',
         'OPENING_FUNDS_CUSTOMER_REQUIRED','OPENING_FUNDS_REFUND_CEILING_REQUIRED','OPENING_FUNDS_BALANCE_REQUIRED',
         'OPENING_FUNDS_ORIGIN_IDENTITY_CONFLICT','OPENING_FUNDS_ITEM_IDENTITY_CONFLICT',
         ...supplierPayableReadRefusals,'SUPPLIER_PAYABLE_VERIFIED_ORIGINAL_REQUIRED','SUPPLIER_SETTLEMENT_PAYABLE_REQUIRED',
         'SUPPLIER_SETTLEMENT_ACTUAL_DATE_REQUIRED','SUPPLIER_SETTLEMENT_VERIFIED_CHANNEL_REQUIRED'].includes(error.message)){
          // eslint-disable-next-line preserve-caught-error -- Only allowlisted outcomes cross after rollback.
          throw new Error(error.message);
        }
        if(error.code==='22023'&&['FINANCE_MAPPING_EFFECTIVE_ORDER_REQUIRED','FINANCE_MAPPING_ACCOUNT_REQUIRED','FINANCE_MAPPING_CLOSURE_REQUIRED',
         'FINANCE_TAX_EFFECTIVE_ORDER_REQUIRED','FINANCE_CHANNEL_EFFECTIVE_ORDER_REQUIRED','FINANCE_CHANNEL_ACCOUNT_REQUIRED',
         'FINANCE_CHANNEL_ACCOUNT_PINNED','FINANCE_CHANNEL_IDENTITY_RETAINED','DIRECT_RECEIPT_TIP_INPUT_REQUIRED',
         'REFUND_TRANSFER_FEE_INPUT_REQUIRED','REFUND_TRANSFER_FEE_EVIDENCE_REQUIRED',
         'COLLECTION_RECREDIT_INPUT_REQUIRED','COLLECTION_RECREDIT_EVIDENCE_REQUIRED',
         'OPENING_AR_EVIDENCE_REQUIRED','OPENING_AR_DATE_REQUIRED','OPENING_AR_AMOUNT_REQUIRED',
         'OPENING_FUNDS_EVIDENCE_REQUIRED','OPENING_FUNDS_DATE_REQUIRED','OPENING_FUNDS_AMOUNT_REQUIRED'].includes(error.message)){
          // eslint-disable-next-line preserve-caught-error -- No SQL detail leaves this confirmed rollback.
          throw new Error(error.message);
        }
      }
      if(role==='crest_finance_preview'&&command&&!combined.aborted&&rollbackConfirmed&&error instanceof Error&&'code' in error
        &&error.code==='23505'&&['COLLECTION_RECREDIT_ALREADY_RECORDED','COLLECTION_RECREDIT_EXTERNAL_ID_ALREADY_RECORDED',
         'OPENING_AR_DUPLICATE_EVIDENCE','OPENING_FUNDS_DUPLICATE_ORIGIN','OPENING_FUNDS_DUPLICATE_REDUCTION','OPENING_FUNDS_DUPLICATE_ITEM',
         'SUPPLIER_PAYABLE_ALREADY_POSTED','SUPPLIER_SETTLEMENT_EXTERNAL_ID_ALREADY_RECORDED'].includes(error.message)){
        // eslint-disable-next-line preserve-caught-error -- The acknowledged rollback confines this response to exact known markers.
        throw new Error(error.message);
      }
      if(role==='crest_finance_preview'&&!transaction&&!combined.aborted&&error instanceof Error&&'code' in error
        &&(error.code==='54000'&&error.message==='COLLECTION_RECREDIT_OPTIONS_LIMIT'
          ||error.code==='23514'&&['COLLECTION_RECREDIT_DATE_REQUIRED','OPENING_RECEIVABLES_CUSTOMER_REQUIRED',
           ...supplierPayableReadRefusals].includes(error.message)
          ||(error.code==='40001'||error.code==='22023')&&error.message==='OPENING_WORKSHEET_REVISION_CONFLICT')){
        // eslint-disable-next-line preserve-caught-error -- The bounded read reports only the exact expected marker.
        throw new Error(error.message);
      }
      if(role==='crest_finance_preview'&&!transaction&&!combined.aborted&&error instanceof Error
        &&'code' in error&&error.code==='22023'&&error.message==='MAPPING_NOT_READY'){
        // eslint-disable-next-line preserve-caught-error -- Only this exact read-only domain marker crosses the database boundary.
        throw new Error('FINANCE_MAPPING_NOT_READY');
      }
      // Only this fixed, expected business-fence result may cross the command
      // profile. No SQL/SDK cause, detail, hint, parameter or raw message escapes.
      // eslint-disable-next-line preserve-caught-error -- Database causes may contain credentials, SQL text or parameters.
      if(command&&error instanceof Error&&'code' in error&&error.code==='P0001'&&error.message==='RECOVERY_REVIEW_REQUIRED')throw new Error('RECOVERY_REVIEW_REQUIRED');
      // eslint-disable-next-line preserve-caught-error -- Never transport a raw database cause outside this boundary.
      throw new Error('SESSION_DATABASE_FAILED');
    }
    finally{clearTimeout(timer);combined.removeEventListener('abort',abort);await client.end().catch(()=>undefined);}
  }
  const query=async(text:string,values:unknown[],signal:AbortSignal)=>connection(signal,'read',current=>current(text,values));
  return Object.assign(query,{transaction:<T>(work:(query:Query,signal:AbortSignal)=>Promise<T>,signal:AbortSignal)=>connection(signal,'refresh',work),
    commandTransaction:<T>(work:(query:Query,signal:AbortSignal)=>Promise<T>,signal:AbortSignal)=>connection(signal,role==='crest_legacy_contact_dispatch'?'contact-import':'command',work),
    admissionTransaction:<T>(work:(query:Query,signal:AbortSignal)=>Promise<T>,signal:AbortSignal)=>connection(signal,'admission',work)});
}
