import 'server-only';
import {pathToFileURL} from 'node:url';
import {createAuthenticationRuntime} from './authentication-runtime.ts';
import {createReceiptDirectory} from '../bookkeeping/expenses/receipt-directory.ts';
import {createReceiptWorkflow} from '../bookkeeping/expenses/receipt-workflow.ts';
import {createLocalSandboxValidator,createSyntheticWindowsSandboxValidator} from '../files/local-sandbox-validator.ts';
import {SandboxValidationError} from '../files/validation-reply.ts';
import {openSyntheticSupplierStore,readSupplierProfile,supplierStoreError,workspaceUuidPattern} from './synthetic-supplier-store.ts';

const failure=()=>Error('SYNTHETIC_EXPENSE_RECEIPT_DISPATCH_UNCONFIRMED');
const [mode,path,workspaceId,businessId,origin,bucket]=process.argv.slice(2);
if(mode!=='--expense-receipt-worker'||!path||!workspaceId||! /^[a-f0-9]{16}$/.test(workspaceId)||!businessId||!workspaceUuidPattern.test(businessId)||!origin||!bucket||!process.send)
 throw failure();

const controller=new AbortController();
let started=false,uncertain=false;
process.once('disconnect',()=>controller.abort());
process.on('message',async (message:unknown)=>{
 if(message&&typeof message==='object'&&'kind' in message&&message.kind==='cancel'){controller.abort();return;}
 if(started){controller.abort();return;}
 started=true;
 let passed=false;
 try{
  if(!message||typeof message!=='object'||!('kind' in message)||message.kind!=='verify'||
   !('credential' in message)||!('receiptId' in message)||!('operationId' in message)||
   typeof message.credential!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(message.credential)||
   typeof message.receiptId!=='string'||!workspaceUuidPattern.test(message.receiptId)||
   typeof message.operationId!=='string'||!workspaceUuidPattern.test(message.operationId))throw failure();
  controller.signal.throwIfAborted();
  const profile=await readSupplierProfile(pathToFileURL(path)),authInput=profile.authentication;
  if(profile.environment!=='test'||profile.documentKind!=='expense-receipt'||profile.businessId!==businessId||
   profile.storage.bucket!=='crest-fictional-receipts-'+workspaceId||
   profile.storage.origin!==origin||profile.storage.bucket!==bucket||
   authInput.database.environment!=='test'||authInput.provider.environment!=='test')throw supplierStoreError();
  const auth=(await createAuthenticationRuntime({...authInput,loginKey:Buffer.from(authInput.loginKey,'base64url'),
   keys:authInput.keys.map((key:{id:string;key:string})=>({id:key.id,key:Buffer.from(key.key,'base64url')}))
  })).forServer();
  const storage=await openSyntheticSupplierStore(profile.storage,workspaceId);
  try{
   const imageId=profile.decoder.imageId;
   const decoder=process.platform==='win32'?createSyntheticWindowsSandboxValidator({
    imageId,dockerExecutable:profile.decoder.dockerExecutable,systemRoot:process.env.SystemRoot??'',
   }):createLocalSandboxValidator({imageId});
   const validator={async validate(...args:Parameters<typeof decoder.validate>){
    try{return await decoder.validate(...args);}
    catch(error){
     if(error instanceof SandboxValidationError&&['SANDBOX_CREATE_UNCERTAIN','SANDBOX_CLEANUP_UNCERTAIN'].includes(error.code))uncertain=true;
     throw error;
    }
   }};
   const directory=createReceiptDirectory({connectionString:auth.configuration.connectionString,environment:'test'},auth.provider,auth.tokens);
   const workflow=createReceiptWorkflow(directory,storage.objects,validator);
   await workflow.prepareAndPublish(message.credential,businessId,message.receiptId,message.operationId,controller.signal);
   controller.signal.throwIfAborted();
   passed=true;
  }finally{storage.close();}
 }catch{/* The request channel receives only a bounded result. */}
 if(uncertain)process.exitCode=1;
 if(process.connected)process.send?.({kind:'finished',passed},error=>{
  if(error)process.exitCode=1;
  if(process.connected)process.disconnect?.();
 });
});
