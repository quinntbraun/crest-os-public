// Controlled focus scheduling for a genuine browser regression. Delay only
// animation-frame callbacks registered during the named Edit button's click.
// No input, request, business record, privacy rule or save guard is changed.
export async function gateEditorFocusFrames(page,buttonName){
 await page.evaluate(name=>{
  const original=window.requestAnimationFrame,native=original.bind(window),held=[];let armed=false;
  const clicked=event=>{const button=event.target instanceof Element?event.target.closest('button'):null;if(button?.textContent?.trim()===name){armed=true;setTimeout(()=>{armed=false;},0);}};
  document.addEventListener('click',clicked,true);
  window.requestAnimationFrame=callback=>{const gated=armed;return native(time=>{if(gated)held.push(()=>callback(time));else callback(time);});};
  window.crestReleaseEditorFocusFrames=async()=>{
   try{await new Promise(resolve=>native(()=>native(resolve)));const count=held.length;for(const callback of held.splice(0))callback();return count;}
   finally{window.requestAnimationFrame=original;document.removeEventListener('click',clicked,true);delete window.crestReleaseEditorFocusFrames;}
  };
 },buttonName);
}
export async function releaseEditorFocusFrames(page){return page.evaluate(()=>window.crestReleaseEditorFocusFrames?.()??0);}
