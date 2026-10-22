// The default release remains a setup shell. There is deliberately no environment
// switch that activates authentication or production data access in this slice.
let application:Awaited<ReturnType<typeof import('./application.ts')['createCrestApplication']>>|undefined;
try{
  Object.assign(process.env,{NODE_ENV:'production'});
  const {createCrestApplication}=await import('./application.ts');
  const raw=process.env.PORT??'3000',host=process.env.CREST_BIND_ADDRESS??'127.0.0.1';
  if(!/^[1-9]\d{0,4}$/.test(raw)||Number(raw)>65535||!['127.0.0.1','0.0.0.0'].includes(host))throw new Error();
  const app=application=await createCrestApplication({origin:`http://127.0.0.1:${raw}`,environment:'test'});
  await new Promise<void>((resolve,reject)=>{app.server.once('error',reject);app.server.listen(Number(raw),host,()=>{app.server.off('error',reject);resolve();});});
  let closing=false;
  const close=()=>{if(closing)return;closing=true;const timer=setTimeout(()=>process.exit(1),10000);timer.unref();void app.close().then(()=>{clearTimeout(timer);},()=>process.exit(1));};
  process.once('SIGTERM',close);process.once('SIGINT',close);
  app.server.on('error',()=>{console.error('APPLICATION_SERVER_FAILED');close();});
}catch{await application?.close().catch(()=>{});console.error('APPLICATION_START_FAILED');process.exitCode=1;}
export {};
