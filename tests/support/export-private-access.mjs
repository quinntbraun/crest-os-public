import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {waitForSessionAdmissionCapacity} from './session-admission-capacity.mjs';

export async function watchExportCopies(page){
 await page.addInitScript(()=>{
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),live=new Set();let created=0,revoked=0;
  URL.createObjectURL=value=>{const url=create(value);live.add(url);created++;return url;};
  URL.revokeObjectURL=url=>{if(live.delete(url))revoked++;return revoke(url);};
  // Counts only. Neither bytes nor private blob URLs leave this document.
  Object.defineProperty(window,'crestExportCopyCounts',{value:()=>({created,revoked,live:live.size})});
 });
}

export async function reviewExportPrivateAccess(page,f,engine){
 const context=page.context(),cookies=await context.cookies(),viewport=page.viewportSize();
 const source=page.getByRole('region',{name:'Business data exports',exact:true}),files=page.getByRole('region',{name:'Download export files',exact:true});
 const financial=page.getByRole('region',{name:'Posted finance export',exact:true}),recovery=page.getByRole('region',{name:'Export access recovery',exact:true});
 const references=()=>page.evaluate(()=>Object.fromEntries(Object.keys(sessionStorage).filter(k=>k.startsWith('crest.pending-export-request.v1:')).sort().map(k=>[k,sessionStorage.getItem(k)])));
 const copies=()=>page.evaluate(()=>window.crestExportCopyCounts());
 async function prepareSource(){
  await files.getByRole('button',{name:'Check sign-in and load file list',exact:true}).click();
  await expect(files.getByRole('status')).toContainText('The complete file list is checked.');
  await files.getByLabel('File to prepare',{exact:true}).selectOption(f.plan.parts[0].partId);
  await files.getByRole('button',{name:'Prepare selected file',exact:true}).click();
  await expect(files.getByRole('button',{name:'Request browser save',exact:true})).toBeEnabled();
 }
 async function deny(button,label){
  const before=await f.facts(),originals=await references();
  await context.clearCookies();
  const denied=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/session'&&r.status()===400);
  await button.click();await denied;
  await expect(recovery).toBeVisible();await expect(recovery.getByRole('status')).toBeFocused();
  for(const item of [source,files,financial])await expect(item).toHaveCount(0);
  await expect(page.locator('.export-request-table,.export-picked-file')).toHaveCount(0);
  await expect(page.locator('.export-collections input,.export-collections textarea,.export-collections select')).toHaveCount(0);
  await expect.poll(async()=>(await copies()).live).toBe(0);
  await expect(recovery.getByRole('link',{name:'Sign in again',exact:true})).toHaveAttribute('href','/sign-in?returnTo=exports');
  await mkdir('.local/review',{recursive:true});
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:900});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   for(const link of await recovery.getByRole('link').all())assert((await link.boundingBox()).height>=44);
   assert((await recovery.getByRole('button',{name:'Check export access',exact:true}).boundingBox()).height>=44);
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations.map(v=>v.id),[]);
   await page.screenshot({path:'.local/review/export-access-denied-'+label+'-'+engine+'-'+width+'.png',fullPage:true});
  }
  assert.equal(JSON.stringify(await references())===JSON.stringify(originals),true,'Export original references remain byte-identical');
  assert.deepEqual(await f.facts(),before,'Denied access does not alter business records or export jobs');
  await context.addCookies(cookies);await page.setViewportSize(viewport);
  await recovery.getByRole('button',{name:'Check export access',exact:true}).click();
  await expect(recovery).toHaveCount(0);await expect(source).toBeVisible();await expect(financial).toBeVisible();
  await expect(source.locator(':scope > .export-status')).toBeFocused();
  assert.equal((await copies()).live,0,'Rechecking access never prepares or saves a file');
  assert.deepEqual(await f.facts(),before,'Explicit access recheck is read-only');
 }
 try{
  await waitForSessionAdmissionCapacity(f,{reserve:70});
  await prepareSource();assert((await copies()).live>=2,'Both genuine prepared copies exist before download denial');
  await deny(files.getByRole('button',{name:'Check sign-in and load file list',exact:true}),'download');
  await prepareSource();assert((await copies()).live>=1);
  await deny(financial.getByRole('button',{name:'Prepare posted finance CSV',exact:true}),'finance');
  const before=await f.facts(),pattern='**/api/business/exports/request';let requests=0;
  const abort=route=>{requests++;return route.abort('failed');};
  await page.route(pattern,abort,{times:1});
  try{
   await source.getByRole('button',{name:'Request business export',exact:true}).click();
   await expect(source.getByRole('region',{name:'Interrupted export request',exact:true})).toBeVisible();
  }
  finally{await page.unroute(pattern,abort);}
  assert.equal(requests,1);assert.deepEqual(await f.facts(),before,'Unsent request has no recorded business effect');
  await source.getByRole('button',{name:'Check original request status',exact:true}).click();
  await expect(source.locator('.export-status').first()).toContainText('does not prove that the request failed');
  await source.getByLabel('Reason for closing this interrupted request',{exact:true}).fill('Private unsent retirement review');
  const original=await references();assert.equal(Object.keys(original).length,1);
  await deny(source.getByRole('button',{name:'Check original request status',exact:true}),'pending-original');
  await expect(source.getByRole('button',{name:'Check original request status',exact:true})).toBeVisible();
  await expect(source.getByLabel('Reason for closing this interrupted request',{exact:true})).toHaveValue('');
  assert.equal(JSON.stringify(await references())===JSON.stringify(original),true);
  assert.equal(requests,1,'Rechecking access does not dispatch the pending request');
 }finally{await context.addCookies(cookies);await page.setViewportSize(viewport);}
}
