// A document can start leaving before a deferred React effect mounts. This
// boundary owns no records and only gates automatic initial reads. Existing
// user-initiated access checks and pagehide/private-clearing remain authoritative.
export function observeInitialReadDeparture(target:EventTarget){
 let departing=false,closed=false;
 const leave=()=>{departing=true;};
 const restore=(event:Event)=>{if((event as PageTransitionEvent).persisted)departing=false;};
 target.addEventListener('beforeunload',leave);
 target.addEventListener('pageshow',restore);
 return Object.freeze({
  canStart:()=>!closed&&!departing,
  dispose(){
   if(closed)return;closed=true;
   target.removeEventListener('beforeunload',leave);
   target.removeEventListener('pageshow',restore);
  },
 });
}
