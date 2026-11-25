import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {waitForSessionAdmissionCapacity} from './session-admission-capacity.mjs';

export async function calendarConsentReferences(page){
 return page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key==='crest.calendar-consent.pending.v1'||key.startsWith('crest.calendar-consent.pending.v2:')).sort().map(key=>({key,value:sessionStorage.getItem(key)})));
}

export async function expectCalendarAccessCleared(page,engine,label,returnUrl){
 const setup=page.getByRole('region',{name:'Fictional Calendar setup'});
 await expect(setup.locator('.settings-feedback')).toHaveText('Sign in again to review Calendar setup.');
 await expect(setup.locator('.settings-feedback')).toBeFocused();
 for(const name of ['Setup overview','Appointment activity workspace','Saved appointment sync'])await expect(page.getByRole('region',{name,exact:true})).toHaveCount(0);
 await expect(setup.locator('input,select,textarea,[data-calendar-consent-state],.calendar-selected-identity')).toHaveCount(0);
 const params=new URL(returnUrl).searchParams,query=new URLSearchParams({returnTo:'calendar'});
 for(const key of ['job','activityFrom','activityThrough'])if(params.has(key))query.set(key,params.get(key));
 await expect(setup.getByRole('link',{name:'Sign in again',exact:true})).toHaveAttribute('href','/sign-in?'+query);
 const viewport=page.viewportSize();
 for(const width of [390,1440]){
  await page.setViewportSize({width,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id),[]);
  assert((await setup.getByRole('link',{name:'Sign in again',exact:true}).boundingBox()).height>=44);
  await page.screenshot({path:'.local/review/settings-calendar-nested-denied-'+label+'-'+engine+'-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize(viewport);
}

export async function reviewCalendarNestedAccess(page,fixture,engine,facts){
 const context=page.context(),cookies=await context.cookies(),selectedUrl=page.url(),before=await facts();
 const original=await calendarConsentReferences(page);
 for(const kind of ['sync','activity']){
  await waitForSessionAdmissionCapacity(fixture,{reserve:40});
  if(kind==='activity')await page.getByRole('button',{name:'Back to appointment activity',exact:true}).click();
  const returnUrl=page.url();
  await context.clearCookies();
  const denied=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/session'&&r.status()===400);
  await page.getByRole('button',{name:kind==='sync'?'Check Calendar status':'Reload activity',exact:true}).click();
  await denied;await expectCalendarAccessCleared(page,engine,kind,returnUrl);
  assert.deepEqual(await calendarConsentReferences(page),original,'All original consent references are preserved byte-for-byte');
  assert.deepEqual(await facts(),before,'A denied read does not change appointments, dispatch or audit records');
  await context.addCookies(cookies);await page.goto(selectedUrl);
  await expect(page.getByRole('region',{name:'Saved appointment sync'}).locator('.calendar-activity-version')).toBeVisible();
 }
}
