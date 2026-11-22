import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {waitForSessionAdmissionCapacity} from './session-admission-capacity.mjs';
import {setTimeout as delay} from 'node:timers/promises';

export async function reviewSupplierPostingAccessRecovery(page,fixture,engine,kind,reference,facts,options={}){
 await waitForSessionAdmissionCapacity(fixture,{reserve:35});
 const key='crest.supplier-posting.pending-reference.v1',raw=await page.evaluate(key=>sessionStorage.getItem(key),key);assert(raw);
 const original=JSON.parse(raw);assert.deepEqual(Object.keys(original).sort(),['schemaVersion','businessId','binding','scopeId','reference'].sort());
 assert.deepEqual(Object.keys(original.reference).sort(),['kind','operationId','recoveryEpoch','id'].sort());
 assert.equal(['kind','operationId','recoveryEpoch','id'].every(key=>original.reference[key]===reference[key]),true,'The retained reference must equal the actual interrupted command');
 assert.equal(original.reference.kind===kind,true);
 const context=page.context(),cookies=await context.cookies(),viewport=page.viewportSize(),before=JSON.stringify(await facts()),observations=[],freshSignIn=kind==='settlement'||options.freshSignIn===true;
 const throughOn=new URL(page.url()).searchParams.get('payablesThrough');
 try{
  await context.clearCookies();const denied=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/session'&&r.status()===400);
  await page.getByRole('button',{name:'Check original posting request',exact:true}).click();await denied;
  await expect(page.getByText('Sign in to view expenses.',{exact:true})).toBeFocused();
  await expect(page.getByRole('region',{name:'Unpaid supplier bill drafts',exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Recorded supplier payables',exact:true})).toHaveCount(0);
  await expect(page.getByRole('form',{name:'Confirm supplier payment',exact:true})).toHaveCount(0);
  const signIn=page.getByRole('link',{name:'Sign in to view expenses',exact:true});await expect(signIn).toHaveAttribute('href','/sign-in?returnTo=expenses&view=suppliers'+(throughOn?'&payablesThrough='+throughOn:''));
  assert.equal((await page.evaluate(key=>sessionStorage.getItem(key),key))===raw,true,'A denied lookup retains the exact original');
  assert.equal(JSON.stringify(await facts())===before,true,'A denied lookup does not change supplier, ledger or audit records');
 }finally{if(!freshSignIn)await context.addCookies(cookies);}
 await page.getByRole('link',{name:'Sign in to view expenses',exact:true}).click();
 if(freshSignIn){
  // A genuine new MFA attempt in a new code window; never replay/retry a code.
  await delay(30000-Date.now()%30000+1000);
  const credentials=fixture.credentials();await page.getByLabel('Email',{exact:true}).fill(credentials.email);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByLabel('Authenticator code',{exact:true}).fill(credentials.code);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Session verified',exact:true})).toBeVisible();
  const current=(await context.cookies()).find(cookie=>cookie.name==='__Host-crest_session');assert(current);
  assert.equal(current.value!==cookies.find(cookie=>cookie.name==='__Host-crest_session')?.value,true,'Recovery must use a genuinely new verified app session');
 }
 await page.getByRole('link',{name:'Return to Expenses',exact:true}).click();
 await expect(page.getByRole('button',{name:'Suppliers',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Check original posting request',exact:true})).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));await expect(page.getByRole('button',{name:'Check original posting request',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Check expense access',exact:true}).click();await expect(page.getByRole('button',{name:'Check original posting request',exact:true})).toBeVisible();
 await page.reload();
 assert.equal(new URL(page.url()).searchParams.get('payablesThrough'),throughOn,'The supplier register date survives sign-in, privacy clearing and reload');
 const region=page.getByRole('region',{name:'Interrupted supplier posting',exact:true}),check=region.getByRole('button',{name:'Check original posting request',exact:true});
 await expect(check).toBeEnabled();await expect(region.getByRole('status')).toBeFocused();
 if(freshSignIn)await expect(region.getByRole('status')).toContainText('Your sign-in changed.');
 await expect(page.getByRole('form',{name:'Confirm supplier bill posting',exact:true})).toHaveCount(0);
 await expect(page.getByRole('form',{name:'Confirm supplier payment',exact:true})).toHaveCount(0);
 await page.waitForLoadState('networkidle',{timeout:10000});
 let requests=0;const observe=request=>{if(new URL(request.url()).pathname.startsWith('/api/'))requests++;};page.on('request',observe);await mkdir('.local/review',{recursive:true});
 try{for(const width of [360,390,1440]){
  await page.setViewportSize({width,height:900});await check.scrollIntoViewIfNeeded();await check.focus();
  const geometry=await check.evaluate(node=>{const r=node.getBoundingClientRect();return {height:r.height,width:r.width,unobscured:document.activeElement===node&&node.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};});
  assert(geometry.height>=44&&geometry.width>=44&&geometry.unobscured);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations.map(v=>v.id),[]);
  const capture='.local/review/supplier-posting-restored-'+kind+'-'+engine+'-'+width+'.png';await page.screenshot({path:capture,animations:'disabled'});observations.push({width,...geometry,capture});
 }}finally{page.off('request',observe);await page.setViewportSize(viewport);}
 assert.equal(requests,0,'Inspecting a restored original must not send business or auth requests');
 assert.equal((await page.evaluate(key=>sessionStorage.getItem(key),key))===raw,true,'Privacy clearing and actual reload retain identical original bytes');
 assert.equal(JSON.stringify(await facts())===before,true,'Restoring and inspecting an original does not write supplier, financial or audit records');
 await writeFile('.local/review/supplier-posting-restored-'+kind+'-'+engine+'.json',JSON.stringify({kind,engine,observations,actualDenied:true,wholeExpenseWorkspaceCleared:true,pagehideAndReload:true,genuineNewSignIn:freshSignIn,originalBytesPreserved:true,inspectionRequests:requests,sourceConserved:true},null,2)+'\n');
 // A new real session has its own admission bucket. Aggregate actor pacing is
 // needed only when these extra inspections keep using the original session.
 if(!freshSignIn)await waitForSessionAdmissionCapacity(fixture,{reserve:40});
}
