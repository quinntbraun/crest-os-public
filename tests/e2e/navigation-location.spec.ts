import {mkdir} from 'node:fs/promises';
import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Shared chrome on actual closed/setup routes. This does not accept configured
// business journeys, private lifecycle, browser zoom or a physical phone.
for(const width of [390,768,1440])test('current workspace section stays distinct from hovered tools at '+width+'px',async({page,browserName})=>{
 await page.setViewportSize({width,height:900});
 const cases=[
  {path:'/customers',href:'/customers',current:'page'},
  {path:'/addresses',href:'/customers',current:'location'},
  {path:'/schedule/work',href:'/schedule',current:'location'},
  {path:'/lead-sources',href:'/leads',current:'location',toolHref:'/lead-sources',toolCurrent:'page'},
  {path:'/quotes',href:'/quotes',current:'page'},
  {path:'/vehicles',href:'/vehicles',current:'page'},
  {path:'/expenses',href:'/expenses',current:'page'},
  {path:'/settings/accounts',href:'/settings/accounts',current:'page'},
 ] as const;
 for(const entry of cases){
  await page.goto(entry.path);
  await expect(page.locator('main h1')).toBeVisible();
  const destinations=page.getByRole('navigation',{name:'Main navigation',exact:true});
  const tools=page.getByRole('navigation',{name:'Workspace tools',exact:true});
  const summary=page.locator('.workspace-menu > summary');
  await summary.click();
  // Tools and the sidebar may both describe the current location, but each
  // visible navigation region must have at most one current destination.
  for(const nav of [destinations,tools]){
   const href=nav===tools&&'toolHref' in entry?entry.toolHref:entry.href;
   const current=nav===tools&&'toolCurrent' in entry?entry.toolCurrent:entry.current;
   const active=nav.locator('a[aria-current]:visible');
   const expected=nav.locator('a[href="'+href+'"]:visible');
   if(await expected.count()){
    await expect(active).toHaveCount(1);
    await expect(expected).toHaveAttribute('aria-current',current);
    const inactive=nav.locator('a:not([aria-current]):visible').first();
    await inactive.hover();
    await expect.poll(async()=>{
     const a=await expected.evaluate(el=>({background:getComputedStyle(el).backgroundColor,marker:getComputedStyle(el).boxShadow}));
     const b=await inactive.evaluate(el=>({background:getComputedStyle(el).backgroundColor,marker:getComputedStyle(el).boxShadow}));
     return a.background!==b.background&&a.marker!=='none'&&b.marker==='none';
    }).toBe(true);
    await inactive.focus();
    await expect(inactive).toBeFocused();
    await expect(expected).toHaveAttribute('aria-current',current);
   }else await expect(active).toHaveCount(0);
  }
  if(entry.path==='/expenses'){
   // The original configured receipt capture showed Leads hovered while
   // Expenses was current. Reproduce the shared chrome without private data.
   await page.keyboard.press('Escape');
   await expect(summary).toBeFocused();
   const current=destinations.locator('a[href="/expenses"]');
   if(await current.isVisible()){
    await destinations.getByRole('link',{name:'Leads',exact:true}).hover();
    await expect(current).toHaveAttribute('aria-current','page');
   }else{
    await summary.click();
    await tools.getByRole('link',{name:'Accounting',exact:true}).hover();
   }
   expect((await new AxeBuilder({page}).include('.workspace-masthead').include('.workspace-destinations').analyze()).violations).toEqual([]);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await mkdir('.local/review',{recursive:true});
   await page.screenshot({path:'.local/review/navigation-location-'+browserName+'-'+width+'.png'});
  }
  if(await page.locator('.workspace-menu').getAttribute('open')!==null)await page.keyboard.press('Escape');
 }
});
