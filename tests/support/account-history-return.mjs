import assert from 'node:assert/strict';
import AxeBuilder from '@axe-core/playwright';
import {expect} from '@playwright/test';

export async function reviewAccountHistoryReturn(page,fixture,engine){
 const settings=page.getByRole('region',{name:'Account settings',exact:true});
 const history=settings.getByRole('region',{name:'Saved account history',exact:true});
 const status=settings.getByRole('status'),selected=new URL(page.url()).searchParams.get('accountHistory');
 assert.match(selected,/^[a-f0-9-]{36}$/);
 const facts=async()=>{
  const rows={};
  for(const table of ['crest.account_versions','crest_private.audit_events'])
   rows[table]=(await fixture.client.query('SELECT to_jsonb(r)::text AS value FROM '+table+' r WHERE business_id=$1 ORDER BY to_jsonb(r)::text COLLATE "C"',[fixture.business])).rows;
  return rows;
 };
 const before=await facts(),reads=[];
 const observe=request=>{if(new URL(request.url()).pathname==='/api/business/finance-accounts/history')reads.push(request);};
 page.on('request',observe);
 const render=async(label,widths)=>{
  for(const width of widths){
   await page.setViewportSize({width,height:900});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   assert.deepEqual((await new AxeBuilder({page}).analyze()).violations,[]);
   await page.screenshot({path:'.local/review/account-history-return-'+label+'-'+engine+'-'+width+'.png',fullPage:true});
  }
 };
 try{
  await settings.getByRole('button',{name:'Check accounting access',exact:true}).click();
  await expect(settings.getByLabel('Show archived accounts',{exact:true})).toBeChecked();
  const reopen=settings.getByRole('button',{name:'Reopen selected account history',exact:true});
  await expect(reopen).toBeVisible();await expect(history).toHaveCount(0);
  await page.reload();
  await expect(reopen).toBeVisible();
  await expect(settings.getByLabel('Show archived accounts',{exact:true})).toBeChecked();
  await expect(history).toHaveCount(0);assert.equal(reads.length,0,'Returning must not automatically fetch account history');
  await render('ready',[360,390,1440]);
  const cookies=await page.context().cookies(); // Genuine fixture session, retained only in memory.
  await page.route('**/api/business/finance-accounts/history',route=>route.abort('failed'),{times:1});
  await reopen.click();await expect(status).toHaveText('Account history could not be verified.');
  await expect(history).toHaveCount(0);await expect(reopen).toBeEnabled();
  assert.equal(new URL(page.url()).searchParams.get('accountHistory'),selected);
  const gate=Promise.withResolvers();
  await page.route('**/api/business/finance-accounts/history',async route=>{await gate.promise;await route.continue();},{times:1});
  try{
   await reopen.click();await expect(status).toHaveText('Loading account history…');
   await expect(reopen).toBeDisabled();await expect(history).toHaveCount(0);
   assert.equal(await settings.getAttribute('aria-busy'),'true');
  }finally{gate.resolve();}
  await expect(history.getByRole('heading',{name:'Fictional closed checking history',exact:true})).toBeFocused();
  await expect(history.getByText('Version 2',{exact:true})).toBeVisible();
  await render('reopened',[360,390,1440]);
  await history.getByRole('button',{name:'Close history',exact:true}).click();
  const origin=settings.getByRole('button',{name:'View history for Fictional closed checking',exact:true});
  await expect(origin).toBeFocused();await expect(history).toHaveCount(0);
  assert.equal(new URL(page.url()).searchParams.has('accountHistory'),false);
  await origin.click();await expect(history.getByRole('heading',{name:'Fictional closed checking history',exact:true})).toBeFocused();
  const expected=Object.fromEntries(new URL(page.url()).searchParams);
  await page.context().clearCookies();await origin.click();
  const signIn=page.getByRole('link',{name:'Sign in again',exact:true});await expect(signIn).toBeVisible();
  assert.deepEqual(Object.fromEntries(new URL(await signIn.getAttribute('href'),fixture.origin).searchParams),{returnTo:'accounting',...expected});
  await expect(history).toHaveCount(0);await expect(page.getByRole('button',{name:'Add account',exact:true})).toHaveCount(0);
  await expect(page.getByText('1000 · Fictional closed checking',{exact:true})).toHaveCount(0);
  await expect(status).toBeFocused();await render('denied',[390,1440]);
  await page.context().addCookies(cookies);await page.reload();await expect(reopen).toBeVisible();
  await expect(settings.getByLabel('Show archived accounts',{exact:true})).toBeChecked();
  await expect(history).toHaveCount(0);
  await settings.getByRole('button',{name:'Clear history selection',exact:true}).click();
  await expect(settings.getByRole('heading',{name:'Chart of accounts',exact:true})).toBeFocused();
  assert.equal(new URL(page.url()).searchParams.has('accountHistory'),false);
  assert.equal(new URL(page.url()).searchParams.get('accountsArchived'),'show');
  assert.deepEqual(await facts(),before,'History navigation cannot alter account versions or the business audit');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(history).toHaveCount(0);
 }finally{page.off('request',observe);}
}
