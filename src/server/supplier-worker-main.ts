import compatibility from '../../release/compatibility.json' with {type:'json'};
import {productionReleaseAccepted} from '../security/production-capabilities.ts';
import {readProductionSupplierWorkerProfile} from './production-supplier-worker.ts';

let worker:Awaited<ReturnType<Awaited<ReturnType<typeof readProductionSupplierWorkerProfile>>['open']>>|undefined;
let failure='PRODUCTION_SUPPLIER_WORKER_START_FAILED';
try{
 Object.assign(process.env,{NODE_ENV:'production'});const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--production-supplier-worker'||!args[1])throw Error();
 if(!productionReleaseAccepted(compatibility)){failure='PRODUCTION_RELEASE_NOT_ACCEPTED';throw Error();}
 worker=await (await readProductionSupplierWorkerProfile(args[1])).open();const owned=worker;
 if(process.env.PORT!==undefined&&(!/^[1-9]\d{0,4}$/.test(process.env.PORT)||Number(process.env.PORT)!==owned.listen.port))throw Error();
 await new Promise<void>((resolve,reject)=>{owned.server.once('error',reject);owned.server.listen(owned.listen.port,owned.listen.address,()=>{owned.server.off('error',reject);resolve();});});
 let closing=false;
 const close=()=>{if(closing)return;closing=true;const timer=setTimeout(()=>process.exit(1),10000);timer.unref();void owned.close().then(()=>clearTimeout(timer),()=>process.exit(1));};
 process.once('SIGTERM',close);process.once('SIGINT',close);owned.server.on('error',()=>{console.error('PRODUCTION_SUPPLIER_WORKER_FAILED');close();});
}catch{await worker?.close().catch(()=>{});console.error(failure);process.exitCode=1;}
