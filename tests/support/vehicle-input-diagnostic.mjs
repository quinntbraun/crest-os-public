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
