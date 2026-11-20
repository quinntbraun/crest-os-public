import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,test} from '@playwright/test';

// This matrix covers the actual closed/setup screens. Configured records and
// browser zoom/physical-device acceptance require their separate workflow tests.
const inventory=JSON.parse(readFileSync('planning/DESIGN_AUDIT_COVERAGE.json','utf8')) as {groups:{id:string;title:string}[]};
const destinations=inventory.groups.filter(group=>/^R\d{2}$/.test(group.id)).map(group=>({id:group.id,path:group.title.match(/\((\/[^)]*)\)/)?.[1]}));
if(destinations.length!==36||destinations.some(destination=>!destination.path))throw new Error('The complete audit destination inventory is required');

test('bundled workspace font responses preserve the original font bytes',async({request})=>{
 for(const file of ['IBMPlexSans-Regular.woff2','IBMPlexSans-SemiBold.woff2']){
  const response=await request.get('/fonts/'+file);
  expect(response.status()).toBe(200);
  const digest=(value:Buffer)=>createHash('sha256').update(value).digest('hex');
  expect(digest(await response.body())).toBe(digest(readFileSync('public/fonts/'+file)));
 }
});

for(const destination of destinations)test(destination.id+' setup typography reflows at normal and doubled text size',async({page,browserName},testInfo)=>{
 await page.goto(destination.path!);
 await expect(page.locator('h1')).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 const originalStyle=await page.locator('html').getAttribute('style');
 try{
  for(const textSize of [16,32])for(const width of [320,390,768,1440,1920]){
   await page.setViewportSize({width,height:900});
   // Text-only resizing preserves the viewport. It is deliberately not labelled
   // browser zoom, pinch zoom, a keyboard check or physical iPhone acceptance.
   await page.evaluate(async size=>{document.documentElement.style.fontSize=size+'px';await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);},textSize);
   const metrics=await page.evaluate(()=>({
    width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
    font:getComputedStyle(document.body).fontFamily,
    faces:[...document.fonts].filter(face=>face.family.includes('IBM Plex')).map(face=>face.status),
    controls:[...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]),select,textarea')].filter(control=>control.getClientRects().length).map(control=>parseFloat(getComputedStyle(control).fontSize))
   }));
   const scope=destination.path+' at '+width+'px with '+textSize+'px root text';
   expect(metrics.scrollWidth,scope).toBeLessThanOrEqual(metrics.width);
   expect(metrics.font,scope).toContain('IBM Plex Sans');
   expect(metrics.faces.length,scope).toBeGreaterThanOrEqual(2);
   expect(metrics.faces.every(status=>status==='loaded'),scope).toBe(true);
   expect(metrics.controls.every(size=>size>=textSize),scope+' controls must respect enlarged text').toBe(true);
   const navigation=await page.evaluate(()=>{
    const nav=document.querySelector('.workspace-destinations');
    if(!nav)return null;
    return {fixed:getComputedStyle(nav).position==='fixed',height:nav.getBoundingClientRect().height,clearance:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--workspace-bottom-clearance')),
     labels:[...nav.querySelectorAll(':scope > a .destination-label')].map(label=>{
      const link=label.closest('a')!.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(label);
      const lines=[...range.getClientRects()];
      return lines.length===1&&lines.every(rect=>rect.left>=link.left-1&&rect.right<=link.right+1);
     })};
   });
   if(navigation){
    expect(navigation.labels).toHaveLength(5);
    expect(navigation.labels.every(Boolean),scope+' destination names stay whole inside their own targets').toBe(true);
    if(navigation.fixed)expect(navigation.clearance,scope+' reserves the actual navigation height').toBeGreaterThanOrEqual(navigation.height);
   }
   if(destination.id==='R01'){
    const welcomeLines=await page.locator('h1').evaluate(heading=>{
     const text=heading.firstChild;
     if(!text||text.textContent?.slice(0,7)!=='Welcome')throw new Error('Expected the sign-in welcome heading');
     const range=document.createRange();range.setStart(text,0);range.setEnd(text,7);
     return range.getClientRects().length;
    });
    expect(welcomeLines,scope+' must fit the welcome word without splitting it').toBe(1);
   }
   if(textSize===32&&(destination.id==='R01'&&width===320||destination.id==='R02'&&(width===320||width===768)))await testInfo.attach('enlarged-text-'+destination.id+'-'+width,{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  }
  if(browserName==='chromium'){
   const cdp=await page.context().newCDPSession(page);
   try{
    await cdp.send('DOM.enable');await cdp.send('CSS.enable');
    const {root}=await cdp.send('DOM.getDocument');
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'h1'});
    const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every(font=>font.isCustomFont&&/^IBMPlexSans/.test(font.postScriptName))).toBe(true);
   }finally{await cdp.detach();}
  }
 }finally{
  await page.locator('html').evaluate((root,style)=>{if(style===null)root.removeAttribute('style');else root.setAttribute('style',style);},originalStyle);
 }
});
