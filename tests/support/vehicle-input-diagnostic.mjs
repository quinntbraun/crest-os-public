// Test-only fixed booleans/event kinds. Never retain entered text, event.data,
// credentials, record IDs, proof values or arbitrary element attributes.
export async function installVehicleInputDiagnostic(page){
 await page.addInitScript(()=>{
  const events=[];let lastForm=null,lastNotes=null,formSequence=0,notesSequence=0;
  function snapshot(){
   const form=document.querySelector('form[aria-label="Vehicle editor"]'),notes=form?.querySelector('textarea[name="notes"]'),save=form?.querySelector('button[type="submit"]');
   if(form!==lastForm){lastForm=form;formSequence++;}if(notes!==lastNotes){lastNotes=notes;notesSequence++;}
   return {visible:document.visibilityState==='visible',formPresent:!!form,formSequence,notesSequence,notesPresent:!!notes,notesEditable:notes instanceof HTMLTextAreaElement&&!notes.disabled,
    staleNotePresent:notes instanceof HTMLTextAreaElement&&notes.value==='Stale original edit',notesEmpty:notes instanceof HTMLTextAreaElement&&notes.value==='',saveDisabled:save instanceof HTMLButtonElement?save.disabled:null,
    busy:document.querySelector('[aria-label="Vehicle directory"]')?.getAttribute('aria-busy')==='true'};
  }
  function remember(kind,event){
   const form=document.querySelector('form[aria-label="Vehicle editor"]');
   if(event&&(!form||!(event.target instanceof Element)||!form.contains(event.target)))return;
   const name=event?.target?.getAttribute('name'),field=['notes','year','vehicle-label','vin','plate','make','model','color','archive-reason'].includes(name)?name:'other';
   if(events.length===32)events.shift();events.push({kind,field,trusted:event?.isTrusted===true,...snapshot()});
  }
  for(const kind of ['beforeinput','input','change','focusin','focusout'])document.addEventListener(kind,event=>remember(kind,event),true);
  document.addEventListener('visibilitychange',()=>remember('visibility'));
  window.addEventListener('pagehide',()=>remember('pagehide'));
  window.crestVehicleInputDiagnostic=()=>({state:snapshot(),events:[...events]});
 });
}
export async function vehicleInputDiagnostic(page){
 return page.evaluate(()=>window.crestVehicleInputDiagnostic?.()??{unavailable:true}).catch(()=>({unavailable:true}));
}
// A read-only draft probe: two native input events in the same browser task,
// through React's actual DOM handlers. It submits nothing and bypasses no guard.
export async function dispatchVehicleInputBurst(page){
 await page.evaluate(()=>{
  const form=document.querySelector('form[aria-label="Vehicle editor"]'),notes=form?.querySelector('textarea[name="notes"]'),plate=form?.querySelector('input[name="plate"]');
  if(!(notes instanceof HTMLTextAreaElement)||!(plate instanceof HTMLInputElement)||notes.matches(':disabled')||plate.matches(':disabled'))throw Error('VEHICLE_INPUT_PROBE_NOT_READY');
  const noteSetter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set,plateSetter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
  if(!noteSetter||!plateSetter)throw Error('VEHICLE_INPUT_PROBE_UNAVAILABLE');
  noteSetter.call(notes,'Synthetic same-task note');notes.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
  plateSetter.call(plate,'00123-BURST');plate.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));
 });
}
export function observeVehicleRequests(page){
 const routes=new Map([['/api/auth/session','session'],['/api/auth/login','login'],['/api/business/vehicles/context','context'],['/api/business/vehicles/save','save'],['/api/business/vehicles/operation','operation'],['/api/business/vehicles/list','list'],['/api/business/vehicles/history','history']]),events=[];
 function remember(event){if(events.length===32)events.shift();events.push(event);}
 function response(reply){const route=routes.get(new URL(reply.url()).pathname);if(route)remember({route,status:reply.status()});}
 function failed(request){const route=routes.get(new URL(request.url()).pathname);if(route)remember({route,transportFailed:true});}
 page.on('response',response);page.on('requestfailed',failed);
 return {report:()=>[...events],stop:()=>{page.off('response',response);page.off('requestfailed',failed);}};
}
