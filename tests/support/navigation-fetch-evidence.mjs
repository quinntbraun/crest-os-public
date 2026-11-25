// Serialized into a disposable browser before application scripts. Observation
// never attaches promise handlers, retries, delays or alters transport arguments.
export function installNavigationFetchEvidence({storageName}){
 const original=globalThis.fetch;let storage;
 try{storage=globalThis.sessionStorage;if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')return;}catch{return;}
 let departing=false,navigationAt=null;
 const supported=!!globalThis.navigation?.addEventListener;
 const documentRoute=()=>['/schedule','/quotes/amendments','/sign-in'].includes(globalThis.location.pathname)?globalThis.location.pathname:'other';
 function read(){
  const empty={version:1,navigationSupported:supported,nextSequence:0,calls:[]};
  try{
   const state=JSON.parse(storage.getItem(storageName)||'{}');
   if(state.version!==1||!Number.isSafeInteger(state.nextSequence)||state.nextSequence<0||!Array.isArray(state.calls))return empty;
   empty.nextSequence=state.nextSequence;
   empty.calls=state.calls.slice(-32).filter(row=>row&&Number.isSafeInteger(row.sequence)&&row.sequence>0&&Number.isSafeInteger(row.invokedAt)).map(row=>({sequence:row.sequence,document:['/schedule','/quotes/amendments','/sign-in'].includes(row.document)?row.document:'other',invokedAt:row.invokedAt,departing:row.departing===true,navigationAt:Number.isSafeInteger(row.navigationAt)?row.navigationAt:null,readyState:['loading','interactive','complete'].includes(row.readyState)?row.readyState:'other',visibility:row.visibility==='hidden'?'hidden':'visible',hasSignal:row.hasSignal===true,initiallyAborted:row.initiallyAborted===true,abortedAt:Number.isSafeInteger(row.abortedAt)?row.abortedAt:null}));
  }catch{/* A missing/unavailable store has no authority over requests. */}
  return empty;
 }
 function save(state){try{storage.setItem(storageName,JSON.stringify(state));}catch{/* Observation is optional; never change a fetch result. */}}
 if(supported){
  globalThis.navigation.addEventListener('navigate',event=>{if(event.destination?.sameDocument===false){departing=true;navigationAt=Date.now();}});
  globalThis.navigation.addEventListener('navigateerror',()=>{departing=false;navigationAt=null;});
  globalThis.navigation.addEventListener('navigatesuccess',()=>{departing=false;navigationAt=null;});
 }
 globalThis.fetch=function(...args){
  try{
   const resource=args[0],url=new URL(typeof resource==='string'?resource:resource?.url,globalThis.location.href);
   if(url.origin===globalThis.location.origin&&url.pathname==='/api/auth/session'){
    const signal=args[1]?.signal??(typeof resource==='object'?resource?.signal:null);
    const state=read();if(state.nextSequence===Number.MAX_SAFE_INTEGER)throw Error();const sequence=++state.nextSequence;
    const row={sequence,document:documentRoute(),invokedAt:Date.now(),departing,navigationAt,readyState:['loading','interactive','complete'].includes(globalThis.document.readyState)?globalThis.document.readyState:'other',visibility:globalThis.document.visibilityState==='hidden'?'hidden':'visible',hasSignal:!!signal,initiallyAborted:signal?.aborted===true,abortedAt:signal?.aborted===true?Date.now():null};
    state.calls.push(row);state.calls=state.calls.slice(-32);save(state);
    if(signal&&typeof signal.addEventListener==='function')signal.addEventListener('abort',()=>{const latest=read(),current=latest.calls.find(call=>call.sequence===sequence);if(current){current.abortedAt=Date.now();save(latest);}},{once:true});
   }
  }catch{/* Private/unusual caller objects are never serialized or rejected. */}
  return Reflect.apply(original,this,args);
 };
 save(read());
}
