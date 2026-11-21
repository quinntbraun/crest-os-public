import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';

// Observe the real saved reservations; layout must not create a scheduling request.
export async function reviewAppointmentComparison(page,engine,state){
 const comparison=page.getByRole('region',{name:'Saved appointment times',exact:true});
 if(!await comparison.count())return;
 const original=page.viewportSize(),reports=[];let writes=0;
 const observe=request=>{if(request.method()==='POST'&&/\/api\/business\/scheduling\/(reschedule|cancel)$/.test(new URL(request.url()).pathname))writes++;};
 page.on('request',observe);
 try{
  for(const width of [320,390,768,1440,1920]){
   await page.setViewportSize({width,height:900});
   await expect(comparison.getByRole('region',{name:'Current appointment',exact:true})).toContainText('Confirmed · Time reserved');
   const proposal=comparison.getByRole('region',{name:'Saved proposed appointment',exact:true});
   if(await proposal.count())await expect(proposal).toContainText('Unconfirmed · No time reserved');
   const communication=page.getByRole('region',{name:'Recorded customer communication',exact:true});
   if(await communication.count())await expect(communication).toContainText('Crest sends no message from this screen.');
   const boxes=await page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};
    return{comparison:rect('.appointment-comparison'),form:rect('.appointment-change-form'),overflow:document.documentElement.scrollWidth>innerWidth};
   });
   assert.equal(boxes.overflow,false);
   if(width<=390){assert(boxes.comparison.height<450,'Phone comparison must leave room for the change form');assert(boxes.form.y>=boxes.comparison.bottom-1);}
   if(width>=1440)assert(boxes.form.x>=boxes.comparison.x+boxes.comparison.width,'Desktop comparison belongs beside the form');
   reports.push({width,...boxes});
  }
  assert.equal(writes,0);
  await writeFile('.local/review/appointment-comparison-'+state+'-'+engine+'.json',JSON.stringify({reports,writes},null,2)+'\n');
 }finally{page.off('request',observe);await page.setViewportSize(original);}
}
