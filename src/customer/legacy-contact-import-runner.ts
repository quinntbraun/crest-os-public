const idleDelay = 2000;
const successDelay = 250;
const maximumFailureDelay = 30000;

export function startLegacyContactImportRunner(dispatch:(signal:AbortSignal)=>Promise<boolean>){
 const controller = new AbortController();
 const {signal} = controller;

 async function run(){
  let wait = idleDelay;
  let failureDelay = idleDelay;
  while(!signal.aborted){
   await new Promise<void>(resolve=>{
    const finish=()=>{
     clearTimeout(timer);
     signal.removeEventListener('abort',finish);
     resolve();
    };
    const timer=setTimeout(finish,wait);
    timer.unref();
    signal.addEventListener('abort',finish,{once:true});
   });
   if(signal.aborted)return;
   try{
    wait = await dispatch(signal) ? successDelay : idleDelay;
    failureDelay = idleDelay;
   }catch{
    // The database retains the same request after a rolled-back attempt.
    wait = failureDelay;
    failureDelay = Math.min(failureDelay*2,maximumFailureDelay);
   }
  }
 }

 const stopped = run();
 return ()=>{
  controller.abort();
  return stopped;
 };
}
