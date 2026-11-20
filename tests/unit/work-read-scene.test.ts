import {expect,it} from 'vitest';
import {workReadDocumentScene} from '../support/work-read-diagnostic.mjs';

function scene(path:string,text:string|null,activeTag='A',activePath='/schedule',visible=true){
 const doc={readyState:'complete',visibilityState:'visible',activeElement:{tagName:activeTag,pathname:activePath,matches:()=>activeTag==='A'},querySelector:()=>text===null?null:{textContent:text},querySelectorAll:()=>[{getClientRects:()=>visible?[{}]:[]}]};
 return workReadDocumentScene({path,doc:doc as unknown as Document});
}
it('distinguishes a vehicle page from a rendered schedule without retaining its return reference',()=>{
 expect(scene('/vehicles',null)).toEqual({route:'/vehicles',readyState:'complete',visibility:'visible',scheduleRendered:false,scheduleState:null,activeTag:'A',activeRoute:'/schedule',focusOnScheduleReturn:true,scheduleReturnVisible:true});
});
it('retains only fixed categories when paths or status text contain private data',()=>{
 const value=scene('/PRIVATE_ID','PRIVATE_NAME PRIVATE_TOKEN','A','/PRIVATE_CUSTOMER',false);
 expect(value.route).toBe('other');expect(value.scheduleState).toBe('other');expect(value.activeRoute).toBe('other');expect(value.scheduleReturnVisible).toBe(false);
 expect(JSON.stringify(value)).not.toMatch(/PRIVATE|TOKEN|NAME|ID/);
});
it('separates blocked initialization from loading and a completed schedule',()=>{
 expect(scene('/schedule','Check schedule access to load saved jobs.').scheduleState).toBe('unverified');
 expect(scene('/schedule','Loading saved jobs…').scheduleState).toBe('loading');
 expect(scene('/schedule','Saved schedule loaded.').scheduleState).toBe('schedule_loaded');
});
