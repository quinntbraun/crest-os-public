// The default release remains a setup shell. Production requires an explicit
// private profile and an accepted release; an environment flag cannot activate it.
import compatibility from '../../release/compatibility.json' with {type:'json'};
let application:Awaited<ReturnType<typeof import('./application.ts')['createCrestApplication']>>|undefined;
let failure='APPLICATION_START_FAILED';
try{
  Object.assign(process.env,{NODE_ENV:'production'});
  const {createCrestApplication}=await import('./application.ts');
  const args=process.argv.slice(2);
  const raw=process.env.PORT??'3000',host=process.env.CREST_BIND_ADDRESS??'127.0.0.1';
  if(!/^[1-9]\d{0,4}$/.test(raw)||Number(raw)>65535||!['127.0.0.1','0.0.0.0'].includes(host))throw new Error();
  let configuration:Parameters<typeof createCrestApplication>[0]={origin:`http://127.0.0.1:${raw}`,environment:'test'},listen={port:Number(raw),address:host};
  if(args.length){
    if(args.length!==2||args[0]!=='--production-config'||!args[1])throw new Error();
    const {productionReleaseAccepted,readProductionProfile}=await import('./production-configuration.ts');
    if(!productionReleaseAccepted(compatibility)){failure='PRODUCTION_RELEASE_NOT_ACCEPTED';throw new Error();}
    ({configuration,listen}=await (await readProductionProfile(args[1])).forServer());
    if(process.env.PORT!==undefined&&Number(process.env.PORT)!==listen.port||process.env.CREST_HEALTH_ORIGIN!==undefined&&process.env.CREST_HEALTH_ORIGIN!==configuration.origin)throw new Error();
  }
  const app=application=await createCrestApplication(configuration);
  await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(listen.port,listen.address,()=>{app.server.off('error',reject);resolve();});});
  let closing=false;
  const close=()=>{if(closing)return;closing=true;const timer=setTimeout(()=>process.exit(1),10000);timer.unref();void app.close().then(()=>{clearTimeout(timer);},()=>process.exit(1));};
  process.once('SIGTERM',close);process.once('SIGINT',close);
  app.server.on('error',()=>{console.error('APPLICATION_SERVER_FAILED');close();});
}catch{await application?.close().catch(()=>{});console.error(failure);process.exitCode=1;}
export {};
