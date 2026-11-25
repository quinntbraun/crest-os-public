// Presentation invalidation only: no identities, amounts, authority or persistence.
let active=0;
const listeners=new Set<(active:number)=>void>();
function notify(){for(const listener of listeners){try{listener(active);}catch{/* Presentation cannot change a financial outcome. */}}}
export function watchFinanceActivity(listener:(active:number)=>void){
 listeners.add(listener);listener(active);
 return ()=>{listeners.delete(listener);};
}
export function startFinanceActivity(){
 active++;notify();let finished=false;
 return ()=>{if(finished)return;finished=true;active--;notify();};
}
