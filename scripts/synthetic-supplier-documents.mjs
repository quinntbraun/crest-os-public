import {fork} from 'node:child_process';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const unavailable=()=>Error('SYNTHETIC_SUPPLIER_DISPATCH_UNCONFIRMED');
const worker=fileURLToPath(new URL('../.local/server/synthetic-supplier-document-worker.mjs',import.meta.url));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function openSyntheticSupplierDocuments(directory,{id,businessId},sourceSchemaVersion){
 if(!['linux','win32'].includes(process.platform)||sourceSchemaVersion!==109||!uuid.test(businessId)||! /^[a-f0-9]{16}$/.test(id))throw unavailable();
 const profileDirectory=join(directory,'supplier-documents'),workerProfile=join(profileDirectory,'worker.json');
 const [root,profile,program]=await Promise.all([lstat(profileDirectory),lstat(workerProfile),lstat(worker)]);
 if(!root.isDirectory()||root.isSymbolicLink()||!profile.isFile()||profile.isSymbolicLink()||profile.size<1||profile.size>16384||!program.isFile()||program.isSymbolicLink())
  throw unavailable();
 const {openSyntheticSupplierStore,readSupplierProfile}=await import('../.local/server/application.mjs');
 const storage=await openSyntheticSupplierStore(await readSupplierProfile(pathToFileURL(join(profileDirectory,'web.json'))),id);
 const shutdown=new AbortController();
 let active=false,uncertain=false;
 const dispatch=async(credential,requestBusiness,originalId,operationId,requestSignal)=>{
  const signal=AbortSignal.any([shutdown.signal,requestSignal]);
  if(active||uncertain||signal.aborted||requestBusiness!==businessId||!uuid.test(originalId)||!uuid.test(operationId)||
   typeof credential!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(credential))throw unavailable();
  active=true;
  try{
   await new Promise((resolve,reject)=>{
    const child=fork(worker,['--supplier-document-worker',workerProfile,id,businessId,storage.stagingOrigin,storage.bucket],{
     execArgv:[],env:{SystemRoot:process.env.SystemRoot,NODE_ENV:'production'},
     windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],
    });
    let reply,settled=false;
    function finish(success){
     if(settled)return;
     settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
     if(success)resolve();else reject(unavailable());
    }
    function cancel(){if(child.connected)child.send({kind:'cancel'},()=>{});}
    function loseWorker(){uncertain=true;cancel();child.kill();finish(false);}
    const timer=setTimeout(loseWorker,85000);
    signal?.addEventListener('abort',cancel,{once:true});
    child.on('message',message=>{
     if(reply!==undefined||message?.kind!=='finished'||typeof message.passed!=='boolean'){loseWorker();return;}
     reply=message.passed;
    });
    child.once('error',loseWorker);
    child.once('close',(code,exitSignal)=>{
     if(code!==0||exitSignal!==null||reply===undefined)uncertain=true;
     finish(code===0&&exitSignal===null&&reply===true&&!signal?.aborted);
    });
    child.send({kind:'verify',credential,originalId,operationId},error=>{if(error)loseWorker();});
    if(signal?.aborted)cancel();
   });
  }finally{active=false;}
 };
 return {runtime:{objects:storage.objects,stagingOrigin:storage.stagingOrigin,dispatch},
  close(){shutdown.abort();storage.close();}};
}
