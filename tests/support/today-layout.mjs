import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
export async function assertTodayLayout(page){
 const [main,attention,feature,agenda]=await Promise.all(['.today-primary','.today-secondary','.today-visit-feature','.today-primary > .home-panel'].map(selector=>page.locator(selector).boundingBox()));
 assert(main&&attention&&feature&&agenda);const width=page.viewportSize().width;
 assert(feature.y+feature.height<=agenda.y,'next task precedes its agenda');
 if(width>=1100){assert(main.width>=attention.width*1.5,'wide agenda has more room than attention');assert(attention.x>=main.x+main.width,'attention is beside the agenda');assert(Math.abs(feature.y-attention.y)<2,'columns start together');}
 else assert(agenda.y+agenda.height<=attention.y,'phone keeps task and agenda before secondary queues');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Today has no horizontal overflow');
 for(const empty of await page.locator('.today-secondary [data-queue-state="empty"]').all()){
  assert.equal(await empty.locator('ul').count(),0,'compact verified-empty queues contain no hidden records');
  assert.equal(await empty.locator('.primary-action').count(),0,'empty queues do not compete with the next task');
 }
 for(const unknown of await page.locator('.today-secondary [data-queue-state="unknown"]').all())assert.match(await unknown.innerText(),/could not be (?:verified|loaded)/,'unknown queues remain explicitly unverified');
}
export async function captureTodayState(page,name,state){
 const viewport=page.viewportSize();await mkdir('.local/review',{recursive:true});
 try{for(const width of [390,1440]){await page.setViewportSize({width,height:844});await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});await assertTodayLayout(page);assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);await page.screenshot({path:'.local/review/today-agenda-'+state+'-'+name+'-'+width+'.png',fullPage:true});}}
 finally{await page.setViewportSize(viewport);}
}
